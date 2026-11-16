import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { FileReviewView } from "../../product-ui/materials/FileReviewView";
import type { FileReviewProps } from "../../product-ui/materials/types";
import { useFileReviewController } from "../../product-ui/materials/useFileReviewController";

/** Compatibility entry; the existing private workflow owns its original lifecycle. */
export function FileReview(props: FileReviewProps) {
  const controller = useFileReviewController(props);
  return (
    <GlobalProductTheme className="contents">
      <FileReviewView controller={controller} />
    </GlobalProductTheme>
  );
}
