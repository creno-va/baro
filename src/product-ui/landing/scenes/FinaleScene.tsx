import {
  ArrowDown,
  ArrowRight,
  Check,
  Clock3,
  FileText,
  FolderOpen,
  MessageCircle,
} from "lucide-react";
import { sceneClasses } from "../scene-classes";

export default function FinaleScene() {
  return (
    <section
      id="start-with-baro"
      className={sceneClasses("finale")}
      data-finale=""
      aria-labelledby="finale-title"
    >
      <div className={sceneClasses("finale-pin")} data-finale-pin="">
        <div className={sceneClasses("finale-heading")}>
          <p className={sceneClasses("finale-eyebrow")}>YOUR STORY. YOUR NEXT STEP.</p>
          <p className={sceneClasses("finale-opening")}>
            어려웠던 시작이,
            <br />
            <strong>이렇게 달라지도록.</strong>
          </p>
          <p className={sceneClasses("finale-introduction")}>
            편하게 이야기하고, 확인하고, 준비하는 네 가지 경험.
          </p>
        </div>

        <div className={sceneClasses("finale-scene")} data-finale-scene="">
          <div className={sceneClasses("finale-orbits")} aria-hidden="true">
            <i></i>
            <i></i>
            <i></i>
          </div>

          <div className={sceneClasses("finale-inputs")}>
            <article
              className={sceneClasses("finale-feature")}
              data-finale-feature=""
              data-x="-0.82"
              data-y="-0.68"
              data-rotate="-6"
            >
              <span className={sceneClasses("finale-feature-icon")}>
                <MessageCircle size={23} aria-hidden="true" />
              </span>
              <div>
                <span className={sceneClasses("finale-feature-number")}>01 / TALK</span>
                <h3>이야기는 편하게</h3>
                <p>나의 말로 상황을 꺼내요.</p>
              </div>
            </article>
            <article
              className={sceneClasses("finale-feature")}
              data-finale-feature=""
              data-x="0.82"
              data-y="-0.68"
              data-rotate="6"
            >
              <span className={sceneClasses("finale-feature-icon")}>
                <FolderOpen size={23} aria-hidden="true" />
              </span>
              <div>
                <span className={sceneClasses("finale-feature-number")}>02 / COLLECT</span>
                <h3>흩어진 자료는 한곳에</h3>
                <p>필요한 기록을 함께 모아요.</p>
              </div>
            </article>
            <article
              className={sceneClasses("finale-feature")}
              data-finale-feature=""
              data-x="-0.82"
              data-y="0.72"
              data-rotate="4"
            >
              <span className={sceneClasses("finale-feature-icon")}>
                <Clock3 size={23} aria-hidden="true" />
              </span>
              <div>
                <span className={sceneClasses("finale-feature-number")}>03 / CONNECT</span>
                <h3>복잡한 일은 시간순으로</h3>
                <p>날짜를 따라 흐름을 확인해요.</p>
              </div>
            </article>
            <article
              className={sceneClasses("finale-feature")}
              data-finale-feature=""
              data-x="0.82"
              data-y="0.72"
              data-rotate="-5"
            >
              <span className={sceneClasses("finale-feature-icon")}>
                <FileText size={23} aria-hidden="true" />
              </span>
              <div>
                <span className={sceneClasses("finale-feature-number")}>04 / PREPARE</span>
                <h3>중요한 대화는 준비해서</h3>
                <p>내가 검토한 내용으로 시작해요.</p>
              </div>
            </article>
          </div>

          <div className={sceneClasses("finale-brand-token")} aria-hidden="true">
            <div>
              <img src="/brand/logo.svg" width="47" height="47" alt="" />
            </div>
            <span>BARO</span>
          </div>

          <div className={sceneClasses("finale-app")} data-finale-app="" aria-hidden="true">
            <div className={sceneClasses("finale-app-device")}>
              <div className={sceneClasses("finale-app-camera")}></div>
              <div className={sceneClasses("finale-app-status")}>
                <span>9:41</span>
                <span>••• ▰</span>
              </div>
              <div className={sceneClasses("finale-app-heading")}>
                <img src="/brand/logo.svg" width="22" height="22" alt="" />
                <strong>BARO</strong>
                <span>정리 예시</span>
              </div>
              <div className={sceneClasses("finale-app-content")}>
                <div className={sceneClasses("finale-app-greeting")} data-finale-step="0">
                  <p>어떤 일이 있었나요?</p>
                  <span>편하게 이야기해 주세요.</span>
                </div>
                <div className={sceneClasses("finale-app-message")} data-finale-step="1">
                  빌려준 돈을
                  <br />
                  돌려받지 못했어요.
                </div>
                <div className={sceneClasses("finale-app-facts")} data-finale-step="2">
                  <span>
                    <Check size={13} /> 이야기에서 확인한 내용
                  </span>
                  <dl>
                    <div>
                      <dt>계좌 이체</dt>
                      <dd>3월 12일</dd>
                    </div>
                    <div>
                      <dt>돌려받기로 한 날</dt>
                      <dd>추가 확인</dd>
                    </div>
                  </dl>
                </div>
                <div className={sceneClasses("finale-app-files")} data-finale-step="3">
                  <span>
                    <FileText size={12} /> 이체 내역.pdf
                  </span>
                  <span>
                    <MessageCircle size={12} /> 나눈 대화.png
                  </span>
                </div>
                <div className={sceneClasses("finale-app-next")} data-finale-step="4">
                  <span>다음으로 확인할 질문</span>
                  <p>
                    돌려받기로 한 날짜가
                    <br />
                    기억나시나요?
                  </p>
                </div>
              </div>
              <div className={sceneClasses("finale-app-input")}>
                <span>모르면, 나중에 이어가도 돼요</span>
                <ArrowRight size={13} />
              </div>
            </div>
            <span className={sceneClasses("finale-app-orbit-note finale-app-orbit-note-one")}>
              <Check size={14} /> 내 이야기에서 시작
            </span>
            <span className={sceneClasses("finale-app-orbit-note finale-app-orbit-note-two")}>
              <FileText size={14} /> 검토할 내용이 한눈에
            </span>
          </div>

          <div className={sceneClasses("finale-message")} data-finale-message="">
            <p className={sceneClasses("finale-message-kicker")}>복잡한 일도, 하나씩. BARO</p>
            <h2 id="finale-title">
              법률 문제의 시작을,
              <br />
              <span>더 간단하게.</span>
            </h2>
            <p className={sceneClasses("finale-message-line")}>
              이야기는 쉽게. <strong>준비는 빠르게.</strong>
            </p>
            <p className={sceneClasses("finale-message-description")}>
              완벽한 설명을 준비할 필요 없어요.
              <br />
              지금 알고 있는 이야기부터 시작해 보세요.
            </p>
          </div>
        </div>

        <div className={sceneClasses("finale-scene-caption")} aria-hidden="true">
          <span data-finale-stage="">네 가지 경험, 하나의 시작</span>
          <i></i>
          <span>가상의 화면 예시</span>
        </div>

        <div className={sceneClasses("finale-actions")}>
          <a className={sceneClasses("finale-primary")} href="/new">
            내 이야기로 시작하기 <ArrowRight size={19} aria-hidden="true" />
          </a>
          <button
            className={sceneClasses("finale-replay")}
            type="button"
            data-finale-replay=""
            hidden
          >
            <span data-finale-replay-label="">정리되는 과정 보기</span>
            <ArrowDown size={15} aria-hidden="true" />
          </button>
          <p className={sceneClasses("finale-service-note")}>
            BARO는 사실 정리와 상담 준비를 도와요.
            <br className={sceneClasses("finale-mobile-break")} /> 법률 판단은 전문가와 함께하세요.
          </p>
        </div>
      </div>
    </section>
  );
}
