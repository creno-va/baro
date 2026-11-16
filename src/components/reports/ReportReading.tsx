import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import {
  ReportReading as ProductReportReading,
  type ReportReadingProps,
} from "../../product-ui/reports/ReportReading";

export function ReportReading(props: ReportReadingProps) {
  return (
    <GlobalProductTheme>
      <ProductReportReading {...props} />
    </GlobalProductTheme>
  );
}
