import {
  ArrowRight,
  BatteryFull,
  Check,
  CheckCheck,
  FileText,
  FolderOpen,
  Image,
  MessageCircle,
  Mic,
  Paperclip,
  ShieldCheck,
  Signal,
  Sparkles,
  Wifi,
} from "lucide-react";
import { sceneClasses } from "../scene-classes";

const chapters = [
  {
    label: "이야기",
    eyebrow: "01 / 편하게 이야기해요",
    title: "말하는 순간,",
    accent: "정리가 시작돼요.",
    body: "법률 용어를 몰라도 괜찮아요.\n지금 겪고 있는 일을 들려주세요.\nBARO가 하나씩 필요한 질문을 건네요.",
    note: "모르는 내용은 건너뛰고, 나중에 이어서.",
    icon: MessageCircle,
  },
  {
    label: "자료",
    eyebrow: "02 / 자료를 한곳에 모아요",
    title: "흩어진 기록도,",
    accent: "놓치지 않도록.",
    body: "메시지, 계약서, 사진, 녹음까지.\n내 이야기에 필요한 자료를 모아두고\n어떤 사실과 연결되는지 함께 살펴봐요.",
    note: "자료가 아직 없어도 이야기부터 시작해요.",
    icon: FolderOpen,
  },
  {
    label: "타임라인",
    eyebrow: "03 / 흐름이 한눈에 보여요",
    title: "뒤섞인 기억이,",
    accent: "하나의 흐름으로.",
    body: "언제, 어떤 일이 있었는지.\n날짜순으로 정리하며 확인한 사실과\n아직 확인할 내용을 구분해요.",
    note: "내가 직접 확인하고, 언제든 수정할 수 있어요.",
    icon: CheckCheck,
  },
  {
    label: "상담 준비",
    eyebrow: "04 / 다음 한 걸음을 준비해요",
    title: "다시 설명할 걱정,",
    accent: "한결 가볍게.",
    body: "길었던 이야기의 핵심을 리포트에.\n내가 검토한 내용과 선택한 자료로\n변호사와의 첫 상담을 준비하세요.",
    note: "누구에게 무엇을 공유할지는 내가 결정해요.",
    icon: ShieldCheck,
  },
];

// A closed rounded shell, at 280px wide, keeps the 78:163.4:8.75 device proportions.
// Geometry is applied by the client so the page does not need inline style attributes.

const shellFacets = Array.from({ length: 52 }, (_, index) => index);

const lensLayers = [0, 6];

const lensWalls = Array.from({ length: 24 }, (_, index) => index);

const services = [
  { label: "상황 이야기", detail: "편하게 시작하고", icon: MessageCircle },
  { label: "자료 모으기", detail: "흩어진 기록을 모아", icon: FolderOpen },
  { label: "시간순 정리", detail: "흐름을 확인하고", icon: CheckCheck },
  { label: "상담 준비", detail: "다음 한 걸음으로", icon: ShieldCheck },
];

export default function PhoneScene() {
  return (
    <section
      id="phone-story"
      className={sceneClasses("phone-story")}
      data-phone-story=""
      aria-labelledby="phone-story-title"
    >
      <div className={sceneClasses("phone-story-sticky")}>
        <div className={sceneClasses("phone-story-halo")} aria-hidden="true"></div>
        <div className={sceneClasses("phone-story-layout")}>
          <div className={sceneClasses("phone-story-copy")}>
            <p className={sceneClasses("phone-story-overline")}>
              <span></span> 막막함에서, 다음 한 걸음까지
            </p>
            <h2 id="phone-story-title">내 손안의 BARO</h2>
            <div className={sceneClasses("phone-story-chapters")}>
              {chapters.map((chapter, index) => (
                <article
                  key={chapter.label}
                  className={sceneClasses("phone-story-chapter")}
                  id={`phone-chapter-${index}`}
                  data-phone-chapter={index}
                >
                  <p className={sceneClasses("phone-story-kicker")}>
                    <chapter.icon size={18} aria-hidden="true" />
                    {chapter.eyebrow}
                  </p>
                  <h3>
                    {chapter.title}
                    <br />
                    <span className={sceneClasses("phone-story-heading-accent")}>
                      {chapter.accent}
                    </span>
                  </h3>
                  <p className={sceneClasses("phone-story-description")}>
                    {chapter.body.split("\n").map((line) => (
                      <span key={line}>{line}</span>
                    ))}
                  </p>
                  <p className={sceneClasses("phone-story-note")}>
                    <Check size={16} aria-hidden="true" />
                    {chapter.note}
                  </p>
                </article>
              ))}
            </div>
            <section
              className={sceneClasses("phone-story-controls")}
              aria-label="기능 소개 단계 선택"
            >
              {chapters.map((chapter, index) => (
                <button
                  key={chapter.label}
                  type="button"
                  data-phone-step={index}
                  aria-controls={`phone-chapter-${index}`}
                  aria-pressed={index === 0 ? "true" : "false"}
                >
                  <span className={sceneClasses("phone-story-step-number")}>
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {chapter.label}
                </button>
              ))}
            </section>
            <a className={sceneClasses("phone-story-link")} href="/new">
              내 이야기 정리해 보기 <ArrowRight size={18} aria-hidden="true" />
            </a>
          </div>

          <div className={sceneClasses("phone-story-visual")} aria-hidden="true">
            <div className={sceneClasses("phone-story-orbit phone-story-orbit-one")}></div>
            <div className={sceneClasses("phone-story-orbit phone-story-orbit-two")}></div>
            <div className={sceneClasses("phone-story-floor")}></div>
            <div className={sceneClasses("phone-story-perspective")}>
              <div className={sceneClasses("phone-story-device")}>
                <div className={sceneClasses("phone-story-shell")}>
                  {shellFacets.map((index) => (
                    <span
                      key={index}
                      className={sceneClasses("phone-story-shell-facet")}
                      data-phone-facet={index}
                    ></span>
                  ))}
                </div>
                <div className={sceneClasses("phone-story-bevel phone-story-bevel-front")}></div>
                <div className={sceneClasses("phone-story-bevel phone-story-bevel-back")}></div>
                <span
                  className={sceneClasses("phone-story-hardware phone-story-action-button")}
                ></span>
                <span className={sceneClasses("phone-story-hardware phone-story-volume-up")}></span>
                <span
                  className={sceneClasses("phone-story-hardware phone-story-volume-down")}
                ></span>
                <span
                  className={sceneClasses("phone-story-hardware phone-story-side-button")}
                ></span>
                <span
                  className={sceneClasses("phone-story-hardware phone-story-camera-control")}
                ></span>
                <span
                  className={sceneClasses("phone-story-antenna phone-story-antenna-left-top")}
                ></span>
                <span
                  className={sceneClasses("phone-story-antenna phone-story-antenna-left-bottom")}
                ></span>
                <span
                  className={sceneClasses("phone-story-antenna phone-story-antenna-right-top")}
                ></span>
                <span
                  className={sceneClasses("phone-story-antenna phone-story-antenna-right-bottom")}
                ></span>
                <div className={sceneClasses("phone-story-connectors")}>
                  <i className={sceneClasses("phone-story-speakers")}></i>
                  <span className={sceneClasses("phone-story-usb")}></span>
                  <i className={sceneClasses("phone-story-speakers")}></i>
                </div>
                <div className={sceneClasses("phone-story-face phone-story-back")}>
                  <div className={sceneClasses("phone-story-back-finish")}></div>
                  <div className={sceneClasses("phone-story-camera")}>
                    {shellFacets.map((index) => (
                      <i
                        key={index}
                        className={sceneClasses("phone-story-camera-wall")}
                        data-phone-camera-wall={index}
                      ></i>
                    ))}
                    <div
                      className={sceneClasses(
                        "phone-story-camera-step phone-story-camera-step-one",
                      )}
                    ></div>
                    <div
                      className={sceneClasses(
                        "phone-story-camera-step phone-story-camera-step-two",
                      )}
                    ></div>
                    <div
                      className={sceneClasses(
                        "phone-story-camera-step phone-story-camera-step-three",
                      )}
                    ></div>
                    <div className={sceneClasses("phone-story-camera-plate")}></div>
                    {[0, 1, 2].map((lens) => (
                      <div
                        key={lens}
                        className={sceneClasses(`phone-story-lens phone-story-lens-${lens}`)}
                      >
                        {lensWalls.map((wall) => (
                          <i
                            key={wall}
                            className={sceneClasses("phone-story-lens-wall")}
                            data-phone-lens-wall={wall}
                          ></i>
                        ))}
                        {lensLayers.map((layer) => (
                          <i
                            key={layer}
                            className={sceneClasses(
                              `phone-story-lens-ring phone-story-lens-ring-${layer}`,
                            )}
                          ></i>
                        ))}
                        <span className={sceneClasses("phone-story-lens-glass")}>
                          <i></i>
                        </span>
                      </div>
                    ))}
                    <span className={sceneClasses("phone-story-flash")}></span>
                    <span className={sceneClasses("phone-story-lidar")}></span>
                    <span className={sceneClasses("phone-story-camera-mic")}></span>
                  </div>
                </div>
                <div className={sceneClasses("phone-story-face phone-story-front")}>
                  <div className={sceneClasses("phone-story-screen")}>
                    <div className={sceneClasses("phone-story-status")}>
                      <b>9:41</b>
                      <span>
                        <Signal size={12} />
                        <Wifi size={12} />
                        <BatteryFull size={16} />
                      </span>
                    </div>
                    <div className={sceneClasses("phone-story-island")}>
                      <span></span>
                    </div>
                    <div className={sceneClasses("phone-story-appbar")}>
                      <img src="/brand/logo.svg" width="23" height="23" alt="" />
                      <strong>BARO</strong>
                      <span>나의 이야기</span>
                    </div>
                    <div className={sceneClasses("phone-story-screen-panels")}>
                      <div
                        className={sceneClasses("phone-story-screen-panel is-current")}
                        data-phone-screen="0"
                      >
                        <div className={sceneClasses("phone-story-screen-symbol")}>
                          <Sparkles size={28} />
                        </div>
                        <h4>어떤 일이 있었나요?</h4>
                        <p>
                          편하게 이야기해 주세요.
                          <br />
                          함께 하나씩 정리해 볼게요.
                        </p>
                        <div className={sceneClasses("phone-story-bubble phone-story-bubble-me")}>
                          빌려준 돈을 아직
                          <br />
                          돌려받지 못했어요.
                        </div>
                        <div className={sceneClasses("phone-story-bubble phone-story-bubble-baro")}>
                          <img src="/brand/logo.svg" width="18" height="18" alt="" />
                          <span>
                            마음이 많이 쓰이셨겠어요.
                            <br />
                            언제 돈을 빌려주셨나요?
                          </span>
                        </div>
                        <div className={sceneClasses("phone-story-bubble phone-story-bubble-me")}>
                          3월 12일에 계좌로 보냈어요.
                        </div>
                        <div className={sceneClasses("phone-story-screen-insight")}>
                          <Check size={15} />
                          <span>대여 시점이 정리됐어요</span>
                        </div>
                      </div>
                      <div
                        className={sceneClasses("phone-story-screen-panel")}
                        data-phone-screen="1"
                      >
                        <span className={sceneClasses("phone-story-screen-eyebrow")}>
                          나의 사건 자료
                        </span>
                        <h4>
                          기록을 모으면
                          <br />
                          이야기가 선명해져요.
                        </h4>
                        <p>자료와 연결된 사실을 함께 확인해요.</p>
                        <div className={sceneClasses("phone-story-screen-file")}>
                          <FileText size={22} />
                          <div>
                            <strong>계좌 이체 내역.pdf</strong>
                            <small>3월 12일 · 대여 사실</small>
                          </div>
                          <Check size={15} />
                        </div>
                        <div className={sceneClasses("phone-story-screen-file")}>
                          <Image size={22} />
                          <div>
                            <strong>주고받은 대화.png</strong>
                            <small>4월 12일 · 반환 약속</small>
                          </div>
                          <Check size={15} />
                        </div>
                        <div className={sceneClasses("phone-story-screen-file")}>
                          <Mic size={22} />
                          <div>
                            <strong>통화 녹음.m4a</strong>
                            <small>함께 확인할 자료</small>
                          </div>
                          <Check size={15} />
                        </div>
                        <div className={sceneClasses("phone-story-upload")}>
                          <Paperclip size={19} />
                          <span>필요한 자료를 이곳에</span>
                          <small>사진 · 문서 · 녹음</small>
                        </div>
                      </div>
                      <div
                        className={sceneClasses("phone-story-screen-panel")}
                        data-phone-screen="2"
                      >
                        <span className={sceneClasses("phone-story-screen-eyebrow")}>
                          나의 사건 타임라인
                        </span>
                        <h4>이제, 흐름이 보여요.</h4>
                        <p>내가 확인한 사실을 날짜순으로.</p>
                        <ol className={sceneClasses("phone-story-screen-timeline")}>
                          <li>
                            <small>3월 12일</small>
                            <strong>돈을 빌려줬어요</strong>
                            <span>계좌 이체 내역 확인</span>
                            <i>자료 연결됨</i>
                          </li>
                          <li>
                            <small>4월 12일</small>
                            <strong>약속한 날짜가 지났어요</strong>
                            <span>대화에 기록된 반환 예정일</span>
                          </li>
                          <li>
                            <small>다음 확인</small>
                            <strong>그 이후의 대화가 있나요?</strong>
                            <span>추가로 확인할 내용</span>
                            <i className={sceneClasses("is-pending")}>확인 필요</i>
                          </li>
                        </ol>
                      </div>
                      <div
                        className={sceneClasses("phone-story-screen-panel")}
                        data-phone-screen="3"
                      >
                        <span className={sceneClasses("phone-story-screen-eyebrow")}>
                          상담 준비 리포트 · 예시
                        </span>
                        <h4>
                          나의 이야기,
                          <br />
                          한눈에 전할 수 있게.
                        </h4>
                        <p>검토하고, 필요한 자료만 선택해요.</p>
                        <div className={sceneClasses("phone-story-screen-report")}>
                          <span>개인 간 금전 대여</span>
                          <div>
                            <CheckCheck size={20} />
                            <strong>사건의 흐름</strong>
                            <Check size={15} />
                          </div>
                          <div>
                            <FolderOpen size={20} />
                            <strong>확인한 사실과 자료</strong>
                            <Check size={15} />
                          </div>
                          <div>
                            <MessageCircle size={20} />
                            <strong>상담에서 확인할 질문</strong>
                            <Check size={15} />
                          </div>
                        </div>
                        <div className={sceneClasses("phone-story-screen-review")}>
                          <ShieldCheck size={20} />
                          <span>
                            내가 검토한 내용만
                            <br />
                            <strong>내가 선택한 사람에게.</strong>
                          </span>
                        </div>
                        <div className={sceneClasses("phone-story-screen-cta")}>
                          상담 준비 리포트 확인 <ArrowRight size={15} />
                        </div>
                      </div>
                    </div>
                    <div className={sceneClasses("phone-story-arrival")} data-phone-arrival="">
                      <div className={sceneClasses("phone-story-arrival-brand")}>
                        <img src="/brand/logo.svg" width="45" height="45" alt="" />
                        <strong>BARO</strong>
                      </div>
                      <span className={sceneClasses("phone-story-arrival-label")}>
                        법률 상담을 준비하는 나의 공간
                      </span>
                      <h4>
                        막막했던 이야기가,
                        <br />
                        다음 한 걸음이 되도록.
                      </h4>
                      <div className={sceneClasses("phone-story-arrival-services")}>
                        {services.map((service) => (
                          <div key={service.label}>
                            <service.icon size={20} />
                            <span>{service.label}</span>
                            <Check size={12} />
                          </div>
                        ))}
                      </div>
                      <div className={sceneClasses("phone-story-arrival-prompt")}>
                        <span>어떤 일이 있었나요?</span>
                        <ArrowRight size={19} />
                      </div>
                      <p>내 이야기에서 시작해요.</p>
                    </div>
                    <div className={sceneClasses("phone-story-home")}></div>
                  </div>
                  <div className={sceneClasses("phone-story-glass")}></div>
                </div>
              </div>
            </div>
            <div className={sceneClasses("phone-story-services")}>
              {services.map((service, index) => (
                <div
                  key={service.label}
                  className={sceneClasses("phone-story-service-chip")}
                  data-phone-service={index}
                >
                  <span className={sceneClasses("phone-story-service-icon")}>
                    <service.icon size={21} />
                  </span>
                  <div>
                    <small>{service.detail}</small>
                    <strong>{service.label}</strong>
                  </div>
                </div>
              ))}
            </div>
            <span className={sceneClasses("phone-story-visual-caption")}>
              이해를 돕기 위한 가상 화면 · 기능이 하나의 BARO로
            </span>
            <div className={sceneClasses("phone-story-rotation")}>
              <span>360°</span>
              <i></i>
              <small>SCROLL TO EXPLORE</small>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
