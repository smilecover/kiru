/**
 * DOM/XPath helpers exposed to extensions. Parsing is inert: DOMParser never
 * executes scripts or loads resources.
 */

export type DomQueryFunction = 'text' | 'outerHTML' | 'innerHTML' | string | undefined;

function parseDocument(content: string): Document {
  return new DOMParser().parseFromString(String(content ?? ''), 'text/html');
}

export function domQuerySelector(
  content: string,
  selector: string,
  fun?: DomQueryFunction,
): string {
  const document = parseDocument(content);
  const element = document.querySelector(selector);
  if (!element) return '';
  switch (fun) {
    case 'text':
      return element.textContent ?? '';
    case 'innerHTML':
      return element.innerHTML;
    case 'outerHTML':
    case undefined:
    default:
      return element.outerHTML;
  }
}

export function domQuerySelectorAll(content: string, selector: string): string[] {
  const document = parseDocument(content);
  return Array.from(document.querySelectorAll(selector), (element) => element.outerHTML);
}

export function domGetAttributeText(
  content: string,
  selector: string,
  attribute: string,
): string | null {
  const document = parseDocument(content);
  return document.querySelector(selector)?.getAttribute(attribute) ?? null;
}

export function domRemoveSelector(content: string, selector: string): string {
  const document = parseDocument(content);
  for (const element of Array.from(document.querySelectorAll(selector))) {
    element.remove();
  }
  return document.documentElement?.outerHTML ?? '';
}

interface XPathMatches {
  nodes: Element[];
  attrs: (string | null)[];
}

function evaluateNodes(document: Document, expression: string): Node[] {
  const result = document.evaluate(
    expression,
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null,
  );
  const nodes: Node[] = [];
  for (let index = 0; index < result.snapshotLength; index += 1) {
    const node = result.snapshotItem(index);
    if (node) nodes.push(node);
  }
  return nodes;
}

function elementOf(node: Node): Element | null {
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
  if (node.nodeType === Node.ATTRIBUTE_NODE) {
    return (node as Attr).ownerElement;
  }
  return node.parentElement;
}

/**
 * Miru's XPathResult keeps matched elements and a parallel list of attribute
 * values. Expressions ending in `/@attr` still match the owning elements.
 */
function queryXPathMatches(content: string, selector: string): XPathMatches {
  const document = parseDocument(content);
  const expression = selector.trim();
  const attributeMatch = expression.match(/\/(?:@|attribute::)([\w:.-]+)\s*$/);
  if (attributeMatch) {
    const attribute = attributeMatch[1];
    const elementExpression = expression.slice(0, attributeMatch.index).trim() || '.';
    let elements: Element[] = [];
    try {
      elements = evaluateNodes(document, elementExpression)
        .map(elementOf)
        .filter((element): element is Element => Boolean(element));
    } catch {
      elements = [];
    }
    if (elements.length === 0) {
      const attrs = evaluateNodes(document, expression)
        .map(elementOf)
        .filter((element): element is Element => Boolean(element));
      return {
        nodes: attrs,
        attrs: attrs.map((element) => element.getAttribute(attribute)),
      };
    }
    return {
      nodes: elements,
      attrs: elements.map((element) => element.getAttribute(attribute)),
    };
  }

  const nodes: Element[] = [];
  const attrs: (string | null)[] = [];
  for (const node of evaluateNodes(document, expression)) {
    if (node.nodeType === Node.ATTRIBUTE_NODE) {
      const attr = node as Attr;
      if (attr.ownerElement) nodes.push(attr.ownerElement);
      attrs.push(attr.value);
      continue;
    }
    const element = elementOf(node);
    if (element) nodes.push(element);
  }
  return { nodes, attrs };
}

export function domQueryXPath(content: string, selector: string, fun?: string): unknown {
  const result = queryXPathMatches(content, selector);
  const first = result.nodes[0];
  switch (fun) {
    case 'attr':
      return result.attrs.find((value) => value !== null) ?? '';
    case 'attrs':
      return JSON.stringify(result.attrs);
    case 'text':
      return first?.textContent ?? '';
    case 'allHTML':
      return result.nodes.map((element) => element.outerHTML);
    case 'outerHTML':
      return first?.outerHTML ?? '';
    case undefined:
    case '':
    default:
      return first?.textContent ?? '';
  }
}
