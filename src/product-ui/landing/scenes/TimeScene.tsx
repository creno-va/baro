import { ArrowRight, FileCheck2, FolderOpen, MessageCircle } from "lucide-react";
import { cn } from "../../utils";
import { sceneClasses } from "../scene-classes";

export interface TimeSceneProps {
  imageSrc?: string;
  imageAlt?: string;
  imageFocusX?: number;
  imageFocusY?: number;
}

const ticks = Array.from({ length: 60 }, (_, index) => index);

const hours = Array.from({ length: 12 }, (_, index) => {
  const hour = index + 1;
  const angle = (hour * Math.PI) / 6;
  return { hour, x: 320 + Math.sin(angle) * 204, y: 320 - Math.cos(angle) * 204 };
});

const benefits = [
  { icon: MessageCircle, title: "이야기 쉽게 꺼내기", description: "기억나는 일부터, 내 말로." },
  { icon: FolderOpen, title: "자료 한곳에", description: "찾아 헤매던 기록을 모아서." },
  { icon: FileCheck2, title: "상담 준비 빠르게", description: "정리한 내용을 내가 검토하며." },
];

export default function TimeScene({
  imageSrc,
  imageAlt = "아날로그 시계",
  imageFocusX = 50,
  imageFocusY = 50,
}: TimeSceneProps) {
  return (
    <section
      id="time-experience"
      className={sceneClasses("time-experience")}
      data-time-experience=""
      aria-labelledby="time-experience-title"
    >
      <div className={sceneClasses("time-experience-pin")} data-time-pin="">
        <div className={sceneClasses("time-introduction")}>
          <div className={sceneClasses("time-opening")}>
            <p className={sceneClasses("time-eyebrow")}>당신의 시간을 위해</p>
            <p className={sceneClasses("time-opening-title")}>
              찾는 시간은 짧게.
              <br />
              <strong>준비하는 마음은 가볍게.</strong>
            </p>
            <p className={sceneClasses("time-opening-description")}>
              흩어진 기록을 모으고,
              <br />
              같은 이야기를 반복할 부담을 덜어요.
            </p>
            <ul className={sceneClasses("time-opening-chips")} aria-label="상담 준비에 필요한 것">
              <li>편한 대화</li>
              <li>모아 둔 자료</li>
              <li>검토한 이야기</li>
            </ul>
          </div>
          <div className={sceneClasses("time-clock-stage")} aria-hidden="true">
            <div
              className={sceneClasses(cn("time-clock", imageSrc && "time-clock-photo"))}
              data-time-clock=""
              data-time-focus-x={imageFocusX}
              data-time-focus-y={imageFocusY}
            >
              {imageSrc ? (
                <picture>
                  <img
                    className={sceneClasses("time-watch-image")}
                    src={imageSrc}
                    width="900"
                    height="1200"
                    alt={imageAlt}
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
              ) : (
                <svg
                  className={sceneClasses("time-clock-drawing")}
                  viewBox="0 0 640 640"
                  xmlns="http://www.w3.org/2000/svg"
                  focusable="false"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient
                      id="time-clock-metal"
                      x1="100"
                      y1="70"
                      x2="538"
                      y2="602"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop stopColor="#fefefd" />
                      <stop offset=".18" stopColor="#c1c4c4" />
                      <stop offset=".39" stopColor="#f7f7f4" />
                      <stop offset=".65" stopColor="#929a9e" />
                      <stop offset=".84" stopColor="#e3e6e3" />
                      <stop offset="1" stopColor="#fafaf7" />
                    </linearGradient>
                    <linearGradient
                      id="time-clock-inner-rim"
                      x1="150"
                      y1="60"
                      x2="490"
                      y2="610"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop stopColor="#a2a7a7" />
                      <stop offset=".43" stopColor="#fefefd" />
                      <stop offset="1" stopColor="#b7bdbd" />
                    </linearGradient>
                    <radialGradient id="time-clock-ivory" cx=".42" cy=".32" r=".8">
                      <stop stopColor="#fffcf4" />
                      <stop offset=".72" stopColor="#f3f0e7" />
                      <stop offset="1" stopColor="#e8e7df" />
                    </radialGradient>
                    <linearGradient
                      id="time-clock-hands"
                      x1="310"
                      y1="120"
                      x2="329"
                      y2="345"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop stopColor="#687076" />
                      <stop offset=".5" stopColor="#303b43" />
                      <stop offset="1" stopColor="#17232a" />
                    </linearGradient>
                  </defs>
                  <circle
                    cx="320"
                    cy="320"
                    r="299"
                    fill="url(#time-clock-metal)"
                    stroke="#e4e6e4"
                    strokeWidth="2"
                  />
                  <circle cx="320" cy="320" r="283" fill="url(#time-clock-inner-rim)" />
                  <circle
                    cx="320"
                    cy="320"
                    r="273"
                    fill="url(#time-clock-ivory)"
                    stroke="#d6d8d2"
                    strokeWidth="2"
                  />
                  <circle cx="320" cy="320" r="263" fill="none" stroke="#dddcd3" strokeWidth="1" />
                  {ticks.map((tick) => (
                    <line
                      key={tick}
                      x1="320"
                      y1="68"
                      x2="320"
                      y2={tick % 5 === 0 ? "87" : "77"}
                      transform={`rotate(${tick * 6} 320 320)`}
                      stroke={tick % 5 === 0 ? "#485157" : "#959b98"}
                      strokeWidth={tick % 5 === 0 ? "3.5" : "1.5"}
                      strokeLinecap="round"
                    />
                  ))}
                  {hours.map(({ hour, x, y }) => (
                    <text
                      key={hour}
                      x={x}
                      y={y}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#414b50"
                      fontSize="34"
                      fontWeight="400"
                      fontFamily="Arial, sans-serif"
                    >
                      {hour}
                    </text>
                  ))}
                  <g fill="url(#time-clock-hands)">
                    <path
                      d="M 314 344 L 310 287 L 315 174 Q 320 166 325 174 L 330 287 L 326 344 Z"
                      transform="rotate(305 320 320)"
                    />
                    <path
                      d="M 315 349 L 313 278 L 316 116 Q 320 106 324 116 L 327 278 L 325 349 Z"
                      transform="rotate(60 320 320)"
                    />
                  </g>
                  <line
                    x1="320"
                    y1="357"
                    x2="320"
                    y2="93"
                    stroke="#66808e"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="320"
                    cy="320"
                    r="11"
                    fill="#394750"
                    stroke="#a4b0b3"
                    strokeWidth="2"
                  />
                  <circle cx="320" cy="320" r="4" fill="#d4dcdb" />
                </svg>
              )}
            </div>
          </div>
        </div>

        <div className={sceneClasses("time-blue-wipe")} aria-hidden="true" data-time-wipe=""></div>

        <div className={sceneClasses("time-message")} data-time-message="">
          <div className={sceneClasses("time-message-inner")}>
            <h2 id="time-experience-title">
              법률 문제에서,
              <br />
              시간은 중요하니까.
            </h2>
            <p className={sceneClasses("time-promise")}>당신의 시간을 지켜드립니다.</p>
            <p className={sceneClasses("time-description")}>
              자료를 찾고 같은 설명을 반복하는 시간을 줄일 수 있도록.
              <br className={sceneClasses("time-desktop-break")} /> 내 이야기를 정리하는 첫 단계를
              더 쉽고 빠르게.
            </p>
            <ul className={sceneClasses("time-benefits")} aria-label="BARO로 줄이는 준비 시간">
              {benefits.map((benefit, index) => (
                <li
                  key={benefit.title}
                  className={sceneClasses(`time-benefit time-benefit-${index}`)}
                  data-time-benefit=""
                >
                  <span className={sceneClasses("time-benefit-icon")} aria-hidden="true">
                    <benefit.icon size={23} strokeWidth={1.7} />
                  </span>
                  <div>
                    <h3>{benefit.title}</h3>
                    <p>{benefit.description}</p>
                  </div>
                </li>
              ))}
            </ul>
            <div className={sceneClasses("time-actions")}>
              <a className={sceneClasses("time-action-primary")} href="#try-baro">
                직접 체험하기
                <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a className={sceneClasses("time-action-secondary")} href="/new">
                내 이야기 시작하기
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
