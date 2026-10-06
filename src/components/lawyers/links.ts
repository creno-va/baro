import type { V2Contact, V2Office } from "../../contracts/v2/lawyers";
export function contactLinks(contact: V2Contact) {
  return [
    ...(contact.phone
      ? [{ label: "전화", href: `tel:${contact.phone.replace(/[^+0-9]/g, "")}` }]
      : []),
    ...(contact.email
      ? [{ label: "이메일", href: `mailto:${encodeURIComponent(contact.email)}` }]
      : []),
    ...(contact.consultationUrl
      ? [{ label: "외부 상담 페이지", href: contact.consultationUrl }]
      : []),
  ];
}
/** Office-only queries. User location, case and narrative never enter an external URL. */
export function directionLinks(office: V2Office) {
  const query = encodeURIComponent(
    [office.address, office.addressDetail].filter(Boolean).join(" "),
  );
  return [
    { label: "네이버 지도", href: `https://map.naver.com/p/search/${query}` },
    { label: "카카오맵", href: `https://map.kakao.com/link/search/${query}` },
    { label: "Google 길찾기", href: `https://www.google.com/maps/dir/?api=1&destination=${query}` },
  ];
}
