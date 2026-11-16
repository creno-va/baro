import { ImagePlus } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import {
  type ReviewSection,
  replaceReportReviewSection,
  reportSectionTitle,
} from "../../components/reports/review-sections";
import { reportPhotoIds, reportPhotoToken } from "../../utils/report-markdown";
import { Button } from "../Button";
import { TextareaField } from "../Field";
import { SelectField } from "../Select";

export type PhotoChoice = { id: string; name: string; revision?: number; byteLength?: number };
type EditorProps = {
  content: string;
  section: ReviewSection;
  disabled: boolean;
  photos: readonly PhotoChoice[];
  onChange?: ((content: string) => void) | undefined;
};
export function SectionEditor({ content, section, disabled, photos, onChange }: EditorProps) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [photoChoice, setPhotoChoice] = useState("");
  const insert = (addition: string) => {
    const field = input.current;
    if (!field || disabled) return;
    const start = field.selectionStart,
      end = field.selectionEnd;
    const next = section.text.slice(0, start) + addition + section.text.slice(end);
    onChange?.(replaceReportReviewSection(content, section, next));
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + addition.length, start + addition.length);
    });
  };
  const used = reportPhotoIds(content);
  const usedBytes = photos.reduce(
    (sum, photo) => sum + (used.includes(photo.id) ? (photo.byteLength ?? 0) : 0),
    0,
  );
  const unavailable = (photo: PhotoChoice) =>
    used.includes(photo.id) || used.length >= 12 || usedBytes + (photo.byteLength ?? 0) > 8_000_000;
  return (
    <SectionEditorFields
      content={content}
      section={section}
      disabled={disabled}
      photos={photos}
      onChange={onChange}
      inputRef={input}
      photoChoice={photoChoice}
      setPhotoChoice={setPhotoChoice}
      unavailable={unavailable}
      insertPhoto={() => {
        const photo = photos.find((photo) => photo.id === photoChoice);
        if (photo && !unavailable(photo)) {
          insert(`\n\n${reportPhotoToken(photo.id, photo.name)}\n\n`);
          setPhotoChoice("");
        }
      }}
    />
  );
}

/** Keeps the same native textarea identity while values and selection change. */
export function SectionEditorFields({
  content,
  section,
  disabled,
  photos,
  onChange,
  inputRef,
  photoChoice,
  setPhotoChoice,
  unavailable,
  insertPhoto,
}: EditorProps & {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  photoChoice: string;
  setPhotoChoice: (value: string) => void;
  unavailable: (photo: PhotoChoice) => boolean;
  insertPhoto: () => void;
}) {
  return (
    <div data-product-report-section-editor="" className="min-w-0">
      <TextareaField
        ref={inputRef}
        label={`${reportSectionTitle(section.title)} 수정`}
        aria-label={`${reportSectionTitle(section.title)} 수정`}
        value={section.text}
        rows={Math.max(4, Math.min(18, section.text.split(/\r?\n/u).length + 2))}
        disabled={disabled}
        maxLength={Math.max(0, 30000 - content.length + section.text.length)}
        onChange={(event) =>
          onChange?.(replaceReportReviewSection(content, section, event.target.value))
        }
        wrapperClassName="gap-0 [&>label]:sr-only"
        className="min-h-30 text-base leading-8"
      />
      <div className="mt-3 flex min-w-0 flex-wrap items-center gap-2">
        <SelectField
          label={`${reportSectionTitle(section.title)}에 넣을 사진`}
          value={photoChoice}
          onValueChange={setPhotoChoice}
          disabled={disabled || !photos.length}
          options={[
            { value: "", label: "사건 사진 선택" },
            ...photos.map((photo) => ({
              value: photo.id,
              label: photo.name,
              disabled: unavailable(photo),
            })),
          ]}
          wrapperClassName="min-w-0 max-w-full flex-[0_1_260px] gap-0 [&>label]:sr-only"
        />
        <Button
          variant="secondary"
          type="button"
          disabled={disabled || !photos.length}
          onClick={insertPhoto}
        >
          <ImagePlus size={17} aria-hidden="true" />
          사진 넣기
        </Button>
      </div>
    </div>
  );
}
