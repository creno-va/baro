import { ArrowDown, ArrowRight } from "lucide-react";
import { sceneClasses } from "../scene-classes";

export default function OriginScene() {
  return (
    <section
      id="our-beginning"
      className={sceneClasses("origin-story")}
      data-origin-story=""
      aria-labelledby="origin-title"
    >
      <div className={sceneClasses("origin-pin")}>
        <div className={sceneClasses("origin-grain")} aria-hidden="true"></div>
        <div className={sceneClasses("origin-introduction")}>
          <div className={sceneClasses("origin-opening")}>
            <p className={sceneClasses("origin-eyebrow")}>BARO의 시작</p>
            <h2 id="origin-title">
              작은 메모에 담은,
              <br />
              <span>분명한 방향.</span>
            </h2>
            <p className={sceneClasses("origin-body")}>
              어려운 첫걸음을 더 쉽게.
              <br />그 마음을 BARO라는 이름에 담았어요.
            </p>
            <ul className={sceneClasses("origin-values")} aria-label="BARO가 지키는 방향">
              <li>내 말로 시작</li>
              <li>사실부터 정리</li>
              <li>선택은 직접</li>
            </ul>
          </div>
          <figure className={sceneClasses("origin-photo-stage")}>
            <div className={sceneClasses("origin-photo-window")}>
              <div className={sceneClasses("origin-photo-frame")} data-origin-photo="">
                <picture className={sceneClasses("origin-clean-background")}>
                  <img
                    src="/landing/origin-notes-clean.webp"
                    width="2048"
                    height="2731"
                    alt="BARO의 시작을 담은 두 장의 노란 포스트잇"
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
                <picture className={sceneClasses("origin-original-note origin-original-note-left")}>
                  <img
                    src="/landing/origin-notes-original.webp"
                    width="2048"
                    height="2731"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
                <picture
                  className={sceneClasses("origin-original-note origin-original-note-right")}
                >
                  <img
                    src="/landing/origin-notes-original.webp"
                    width="2048"
                    height="2731"
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                </picture>
              </div>
            </div>
            <figcaption>처음 적었던 이름, 그 손글씨 그대로.</figcaption>
          </figure>
        </div>
        <div className={sceneClasses("origin-portal")} aria-hidden="true"></div>
        <div className={sceneClasses("origin-arrival")}>
          <div className={sceneClasses("origin-arrival-inner")}>
            <img src="/brand/logo.svg" width="72" height="72" alt="" />
            <p className={sceneClasses("origin-eyebrow")}>이제, 당신의 다음 한 걸음으로</p>
            <h3>
              종이 위의 한 단어에서,
              <br />
              <span>당신을 위한 BARO로.</span>
            </h3>
            <p>
              이야기는 쉽게. 정리는 차근차근.
              <br />
              다음 준비는 한결 가볍게.
            </p>
            <ol className={sceneClasses("origin-next-steps")} aria-label="BARO에서 시작하는 순서">
              <li>
                <span>01</span>이야기 꺼내기
              </li>
              <li>
                <span>02</span>자료 연결하기
              </li>
              <li>
                <span>03</span>내가 검토하기
              </li>
            </ol>
            <a href="#blue-app-reveal">
              BARO 안으로 <ArrowRight size={20} aria-hidden="true" />
            </a>
          </div>
        </div>
        <div className={sceneClasses("origin-scroll-cue")} aria-hidden="true">
          <span>그 이름 안으로, 스크롤해 보세요</span>
          <ArrowDown size={18} />
        </div>
        <button className={sceneClasses("origin-skip")} type="button" data-origin-open="" hidden>
          BARO로 들어가기 <ArrowRight size={17} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
