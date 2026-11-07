/** The main Worker admits larger SEO analysis JSON only at its authenticated archive import route. */
export const DEFAULT_REQUEST_BODY_LIMIT=16_384;
export const TAYFUN_AI_REQUEST_BODY_LIMIT=131_072;
export function requestBodyLimit(request:Pick<Request,'method'|'url'>):number{
 const path=new URL(request.url).pathname;
 return request.method==='POST'&&path==='/api/independent/tayfun-ai'
  ?TAYFUN_AI_REQUEST_BODY_LIMIT:DEFAULT_REQUEST_BODY_LIMIT;
}
