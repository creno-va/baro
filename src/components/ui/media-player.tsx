import { GlobalProductTheme } from "../../product-ui/GlobalTheme";
import { MediaPlayerView } from "../../product-ui/playback/MediaPlayerView";
import {
  type MediaPlayerProps,
  useMediaPlayerController,
} from "../../product-ui/playback/useMediaPlayerController";

/** Native decoding and access guards remain owned by the existing player. */
export function MediaPlayer(props: MediaPlayerProps) {
  const controller = useMediaPlayerController(props);
  return (
    <GlobalProductTheme className="contents">
      <MediaPlayerView controller={controller} />
    </GlobalProductTheme>
  );
}
