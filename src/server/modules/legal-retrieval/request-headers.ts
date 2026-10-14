// The approved MOLEG application registers baro.site as its domain. Its internet
// API checks Referer (official support cases 22/27/30). This is the service's
// fixed identity, never an incoming request URL, private case path or cookie.
export const LAW_API_REFERER = "https://baro.site/";
