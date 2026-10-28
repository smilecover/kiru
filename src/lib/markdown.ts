import DOMPurify from 'dompurify';
import { marked } from 'marked';

marked.setOptions({
  gfm: true,
  breaks: true,
});

/** Render untrusted extension or TMDB copy as safe HTML. */
export function renderMarkdown(value?: string | null): string {
  const text = (value ?? '').trim();
  if (!text) return '';
  const rendered = marked.parse(text) as string;
  return DOMPurify.sanitize(rendered, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
}
