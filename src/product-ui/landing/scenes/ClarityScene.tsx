import { ArrowDown, ArrowRight, Check, FileText, MessageCircle, Paperclip } from "lucide-react";
import { sceneClasses } from "../scene-classes";

export default function ClarityScene() {
  return (
    <section
      id="clarity"
      className={sceneClasses("clarity-section")}
      data-clarity=""
      aria-labelledby="clarity-title"
    >
      <div className={sceneClasses("clarity-pin")} data-clarity-pin="">
        <header className={sceneClasses("clarity-heading")}>
          <p className={sceneClasses("clarity-eyebrow")}>COMPLEXITY INTO CLARITY</p>
          <h2 id="clarity-title">
            흩어져 있던 걱정이,
            <br />
            <span className={sceneClasses("clarity-heading-emphasis")}>다음 한 걸음이 되도록.</span>
          </h2>
          <p className={sceneClasses("clarity-description")}>
            어디서부터 시작할지 몰랐던 이야기.
            <br className={sceneClasses("clarity-mobile-break")} /> BARO에서 하나씩 모아보세요.
          </p>
        </header>

        <div className={sceneClasses("clarity-controls")} data-clarity-controls="" hidden>
          <section className={sceneClasses("clarity-topics")} aria-label="정리해 볼 고민 선택">
            <button
              type="button"
              className={sceneClasses("clarity-topic")}
              data-clarity-topic="deposit"
              aria-pressed="true"
            >
              보증금
            </button>
            <button
              type="button"
              className={sceneClasses("clarity-topic")}
              data-clarity-topic="money"
              aria-pressed="false"
            >
              빌려준 돈
            </button>
            <button
              type="button"
              className={sceneClasses("clarity-topic")}
              data-clarity-topic="work"
              aria-pressed="false"
            >
              일터의 고민
            </button>
          </section>
        </div>

        <div className={sceneClasses("clarity-visual")} data-clarity-visual="">
          <div className={sceneClasses("clarity-cloud")} aria-hidden="true">
            <div
              className={sceneClasses("clarity-input clarity-input-quote")}
              data-clarity-input=""
              data-x="-0.74"
              data-y="-0.9"
              data-turn="-8"
            >
              <MessageCircle size={16} />
              <span data-clarity-quote="0">
                계약은 끝났는데,
                <br />
                보증금을 못 받았어요.
              </span>
            </div>
            <div
              className={sceneClasses("clarity-input clarity-input-quote")}
              data-clarity-input=""
              data-x="0.76"
              data-y="-0.84"
              data-turn="7"
            >
              <MessageCircle size={16} />
              <span data-clarity-quote="1">
                어떤 이야기부터
                <br />
                꺼내야 할까요?
              </span>
            </div>
            <div
              className={sceneClasses("clarity-input clarity-input-file")}
              data-clarity-input=""
              data-x="-0.91"
              data-y="0.1"
              data-turn="5"
            >
              <FileText size={24} />
              <div>
                <small>내가 가진 자료</small>
                <span data-clarity-file="0">임대차 계약서.pdf</span>
              </div>
              <Paperclip size={14} />
            </div>
            <div
              className={sceneClasses("clarity-input clarity-input-file")}
              data-clarity-input=""
              data-x="0.92"
              data-y="0.13"
              data-turn="-6"
            >
              <FileText size={24} />
              <div>
                <small>흩어져 있던 기록</small>
                <span data-clarity-file="1">주고받은 문자.png</span>
              </div>
              <Paperclip size={14} />
            </div>
            <div
              className={sceneClasses("clarity-input clarity-input-quote")}
              data-clarity-input=""
              data-x="-0.58"
              data-y="0.91"
              data-turn="-5"
            >
              <MessageCircle size={16} />
              <span data-clarity-quote="2">
                연락했던 날짜가
                <br />잘 기억나지 않아요.
              </span>
            </div>
            <div
              className={sceneClasses("clarity-input clarity-input-quote")}
              data-clarity-input=""
              data-x="0.62"
              data-y="0.94"
              data-turn="8"
            >
              <MessageCircle size={16} />
              <span data-clarity-quote="3">
                무슨 자료부터
                <br />
                준비해야 하죠?
              </span>
            </div>
          </div>

          <div className={sceneClasses("clarity-brand")} aria-hidden="true">
            <div className={sceneClasses("clarity-brand-orbit clarity-brand-orbit-one")}></div>
            <div className={sceneClasses("clarity-brand-orbit clarity-brand-orbit-two")}></div>
            <div className={sceneClasses("clarity-brand-core")}>
              <img src="/brand/logo.svg" width="52" height="52" alt="" />
            </div>
            <span>BARO</span>
            <p>복잡한 일도, 하나씩.</p>
          </div>

          <div className={sceneClasses("clarity-results")}>
            <figure className={sceneClasses("clarity-help")}>
              <picture>
                <source media="(min-width: 768px)" srcSet="/landing/help-clarity.webp" />
                <img
                  src="/landing/help-clarity.webp"
                  width="1024"
                  height="688"
                  loading="lazy"
                  decoding="async"
                  alt="두 사람이 휴대폰과 종이를 함께 살펴보는 AI 제작 장면"
                />
              </picture>
              <div className={sceneClasses("clarity-help-shade")}></div>
              <div className={sceneClasses("clarity-help-copy")}>
                <span>READY FOR YOUR NEXT STEP</span>
                <p>
                  이야기가 정리되면,
                  <br />
                  다음이 보이기 시작해요.
                </p>
              </div>
              <figcaption>AI 제작 장면 · 실제 이용 후기 아님</figcaption>
            </figure>

            <div
              id="clarity-results"
              className={sceneClasses("clarity-output-list")}
              data-clarity-results=""
              aria-live="polite"
              aria-atomic="true"
            >
              <article className={sceneClasses("clarity-output")} data-clarity-output="0">
                <div className={sceneClasses("clarity-output-label")}>
                  <span>01</span>
                  <p>시간의 흐름</p>
                  <Check size={16} aria-hidden="true" />
                </div>
                <h3>기억이, 타임라인으로.</h3>
                <p data-clarity-result="0">계약일과 종료일, 연락한 날짜를 차례로 모아요.</p>
                <span className={sceneClasses("clarity-result-detail")} data-clarity-detail="0">
                  계약 → 대화 → 지금의 상황
                </span>
              </article>
              <article className={sceneClasses("clarity-output")} data-clarity-output="1">
                <div className={sceneClasses("clarity-output-label")}>
                  <span>02</span>
                  <p>확인한 내용</p>
                  <Check size={16} aria-hidden="true" />
                </div>
                <h3>흩어진 자료가, 사실의 근거로.</h3>
                <p data-clarity-result="1">계약 내용과 보증금, 확인한 대화를 구분해요.</p>
                <span className={sceneClasses("clarity-result-detail")} data-clarity-detail="1">
                  내가 말한 사실 · 자료에서 확인한 내용
                </span>
              </article>
              <article className={sceneClasses("clarity-output")} data-clarity-output="2">
                <div className={sceneClasses("clarity-output-label")}>
                  <span>03</span>
                  <p>다음 한 걸음</p>
                  <Check size={16} aria-hidden="true" />
                </div>
                <h3>막연한 걱정이, 준비할 질문으로.</h3>
                <p data-clarity-result="2">아직 모르는 내용과 상담에서 확인할 질문을 남겨요.</p>
                <span className={sceneClasses("clarity-result-detail")} data-clarity-detail="2">
                  확인할 내용 · 필요한 자료 · 상담 질문
                </span>
              </article>
            </div>
          </div>
        </div>

        <div className={sceneClasses("clarity-scene-footer")}>
          <div className={sceneClasses("clarity-phase")} aria-hidden="true">
            <span data-clarity-phase-number="">01</span>
            <span className={sceneClasses("clarity-phase-track")}>
              <i></i>
            </span>
            <span data-clarity-phase-label="">흩어진 이야기를 모아요</span>
          </div>
          <button
            className={sceneClasses("clarity-play")}
            type="button"
            data-clarity-play=""
            aria-controls="clarity-results"
            aria-expanded="false"
            hidden
          >
            <span data-clarity-play-label="">정리되는 과정 보기</span>
            <ArrowDown size={16} aria-hidden="true" />
          </button>
          <a className={sceneClasses("clarity-start")} href="/new">
            내 이야기로 시작하기 <ArrowRight size={16} aria-hidden="true" />
          </a>
        </div>
        <p className={sceneClasses("clarity-note")}>
          이해를 돕기 위한 정리 예시예요. 내용은 직접 확인하고, 법률 판단은 전문가와 함께하세요.
        </p>
      </div>
    </section>
  );
}
