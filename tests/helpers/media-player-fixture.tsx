import { useState } from "react";
import { Button } from "../../src/components/ui/button";
import { MediaPlayer } from "../../src/components/ui/media-player";
import silentVideo from "../fixtures/media/scenes-silent.mp4?url";

export function MediaPlayerFixture() {
  const [open, setOpen] = useState(true);
  const [enabled, setEnabled] = useState(true);
  return (
    <section>
      <h1>합성 원본 재생</h1>
      {open && (
        <MediaPlayer
          kind="audio"
          src="/__synthetic-audio.wav"
          label="합성 녹음"
          enabled={enabled}
        />
      )}
      <Button variant="outline" onClick={() => setOpen(false)}>
        원본 음성 닫기
      </Button>
      <Button variant="outline" onClick={() => setEnabled((value) => !value)}>
        {enabled ? "원본 접근 잠그기" : "원본 접근 풀기"}
      </Button>
      <MediaPlayer kind="video" src={silentVideo} label="합성 영상" />
    </section>
  );
}
