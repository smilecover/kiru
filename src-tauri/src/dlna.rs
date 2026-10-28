use std::collections::HashSet;
use std::net::{SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

use serde::Serialize;
use url::Url;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DlnaDevice {
    pub id: String,
    pub name: String,
    pub model: String,
    pub location: String,
    pub control_url: String,
    pub service_type: String,
}

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn child_text(node: roxmltree::Node, name: &str) -> Option<String> {
    node.children()
        .find(|child| child.is_element() && child.tag_name().name() == name)
        .and_then(|child| child.text())
        .map(|text| text.trim().to_string())
}

fn first_descendant_text(doc: &roxmltree::Document, name: &str) -> Option<String> {
    doc.descendants()
        .find(|node| node.is_element() && node.tag_name().name() == name)
        .and_then(|node| node.text())
        .map(|text| text.trim().to_string())
}

#[tauri::command]
pub async fn dlna_discover() -> Result<Vec<DlnaDevice>, String> {
    discover().await
}

async fn discover() -> Result<Vec<DlnaDevice>, String> {
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    socket
        .set_read_timeout(Some(Duration::from_millis(400)))
        .map_err(|e| e.to_string())?;
    let request = concat!(
        "M-SEARCH * HTTP/1.1\r\n",
        "HOST: 239.255.255.250:1900\r\n",
        "MAN: \"ssdp:discover\"\r\n",
        "MX: 3\r\n",
        "ST: urn:schemas-upnp-org:device:MediaRenderer:1\r\n",
        "\r\n"
    );
    let target: SocketAddr = "239.255.255.250:1900".parse().unwrap();
    for _ in 0..3 {
        let _ = socket.send_to(request.as_bytes(), target);
        std::thread::sleep(Duration::from_millis(80));
    }

    let deadline = Instant::now() + Duration::from_secs(3);
    let mut locations = Vec::new();
    let mut seen_locations = HashSet::new();
    let mut buffer = [0u8; 8192];
    while Instant::now() < deadline {
        match socket.recv_from(&mut buffer) {
            Ok((size, _)) => {
                let text = String::from_utf8_lossy(&buffer[..size]);
                for line in text.lines() {
                    if let Some((key, value)) = line.split_once(':') {
                        if key.trim().eq_ignore_ascii_case("LOCATION") {
                            let location = value.trim().to_string();
                            if !location.is_empty() && seen_locations.insert(location.clone()) {
                                locations.push(location);
                            }
                        }
                    }
                }
            }
            Err(err) => {
                if err.kind() != std::io::ErrorKind::WouldBlock
                    && err.kind() != std::io::ErrorKind::TimedOut
                {
                    break;
                }
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(4))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let mut devices = Vec::new();
    let mut seen_ids = HashSet::new();
    for location in locations {
        let Ok(response) = client.get(&location).send().await else {
            continue;
        };
        let Ok(text) = response.text().await else {
            continue;
        };
        let Ok(doc) = roxmltree::Document::parse(&text) else {
            continue;
        };
        let name = first_descendant_text(&doc, "friendlyName")
            .unwrap_or_else(|| "DLNA 设备".to_string());
        let model = first_descendant_text(&doc, "modelName").unwrap_or_default();
        let udn = first_descendant_text(&doc, "UDN").unwrap_or_else(|| location.clone());
        let base = first_descendant_text(&doc, "URLBase")
            .and_then(|value| Url::parse(&value).ok())
            .or_else(|| Url::parse(&location).ok());
        let Some(base) = base else {
            continue;
        };

        for service in doc.descendants().filter(|node| {
            node.is_element() && node.tag_name().name() == "service"
        }) {
            let Some(service_type) = child_text(service, "serviceType") else {
                continue;
            };
            if !service_type.contains("AVTransport") {
                continue;
            }
            let Some(control) = child_text(service, "controlURL") else {
                continue;
            };
            let Ok(control_url) = base.join(&control) else {
                continue;
            };
            let control_url = control_url.to_string();
            if !seen_ids.insert(control_url.clone()) {
                continue;
            }
            devices.push(DlnaDevice {
                id: udn.clone(),
                name: name.clone(),
                model: model.clone(),
                location: location.clone(),
                control_url,
                service_type,
            });
        }
    }
    devices.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(devices)
}

fn envelope(service_type: &str, action: &str, args: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\
<s:Envelope s:encodingStyle=\"http://schemas.xmlsoap.org/soap/encoding/\" \
xmlns:s=\"http://schemas.xmlsoap.org/soap/envelope/\">\
<s:Body><u:{action} xmlns:u=\"{service_type}\">\
<InstanceID>0</InstanceID>{args}</u:{action}></s:Body></s:Envelope>"
    )
}

fn didl_metadata(url: &str, title: &str) -> String {
    format!(
        "<DIDL-Lite xmlns=\"urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/\" \
xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
xmlns:upnp=\"urn:schemas-upnp-org:metadata-1-0/upnp/\">\
<item id=\"0\" parentID=\"-1\" restricted=\"1\">\
<dc:title>{}</dc:title>\
<upnp:class>object.item.videoItem</upnp:class>\
<res protocolInfo=\"http-get:*:video/mp4:*\">{}</res>\
</item></DIDL-Lite>",
        xml_escape(title),
        xml_escape(url)
    )
}

fn find_xml_text(doc: &roxmltree::Document, name: &str) -> String {
    doc.descendants()
        .find(|node| node.is_element() && node.tag_name().name() == name)
        .and_then(|node| node.text())
        .unwrap_or_default()
        .trim()
        .to_string()
}

#[tauri::command]
pub async fn dlna_action(
    control_url: String,
    service_type: String,
    action: String,
    value: Option<String>,
    title: Option<String>,
) -> Result<serde_json::Value, String> {
    let mut args = String::new();
    match action.as_str() {
        "setUri" => {
            let url = value.ok_or("缺少播放地址")?;
            let metadata = didl_metadata(&url, title.as_deref().unwrap_or("Kiru"));
            args.push_str(&format!(
                "<CurrentURI>{}</CurrentURI><CurrentURIMetaData>{}</CurrentURIMetaData>",
                xml_escape(&url),
                xml_escape(&metadata)
            ));
        }
        "play" => args.push_str("<Speed>1</Speed>"),
        "seek" => {
            let seconds: u64 = value
                .as_deref()
                .unwrap_or("0")
                .parse()
                .map_err(|_| "时间格式错误")?;
            let target = format!(
                "{:02}:{:02}:{:02}",
                seconds / 3600,
                (seconds % 3600) / 60,
                seconds % 60
            );
            args.push_str(&format!(
                "<Unit>REL_TIME</Unit><Target>{target}</Target>"
            ));
        }
        "playPause" | "pause" | "stop" | "info" | "position" => {}
        other => return Err(format!("不支持的操作: {other}")),
    }

    let body = envelope(&service_type, &action_name(&action), &args);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .no_proxy()
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(&control_url)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header(
            "SOAPACTION",
            format!("\"{service_type}#{}\"", action_name(&action)),
        )
        .body(body)
        .send()
        .await
        .map_err(|e| format!("DLNA 请求失败: {e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("DLNA 设备返回 HTTP {status}: {text}"));
    }

    let doc = roxmltree::Document::parse(&text).ok();
    let (state, position, duration) = if let Some(doc) = &doc {
        (
            find_xml_text(doc, "CurrentTransportState"),
            find_xml_text(doc, "RelTime"),
            find_xml_text(doc, "TrackDuration"),
        )
    } else {
        (String::new(), String::new(), String::new())
    };
    Ok(serde_json::json!({
        "state": state,
        "position": position,
        "duration": duration,
        "raw": text,
    }))
}

fn action_name(action: &str) -> String {
    match action {
        "setUri" => "SetAVTransportURI".to_string(),
        "play" => "Play".to_string(),
        "pause" => "Pause".to_string(),
        "playPause" => "Pause".to_string(),
        "stop" => "Stop".to_string(),
        "seek" => "Seek".to_string(),
        "info" => "GetTransportInfo".to_string(),
        "position" => "GetPositionInfo".to_string(),
        other => other.to_string(),
    }
}
