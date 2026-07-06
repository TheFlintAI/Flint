/** Parse an HTML string into a Document via DOMParser. */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}
