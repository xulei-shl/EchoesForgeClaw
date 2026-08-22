import type { FC } from "react";
import { Composition } from "remotion";
import { Endpoint } from "./Endpoint";
import { Expressions } from "./Expressions";
import { Launch } from "./Launch";
import { END, FPS, HEIGHT, WIDTH } from "./timeline";
import { END as REEL_END } from "./reel";
import { END as EP_END } from "./url";
import { Triangles, END as TRI_END } from "./Triangles";
import { Adapters } from "./Adapters";
import { END as SWAP_END } from "./swap";
import { Thanks } from "./Thanks";
import { END as STARS_END } from "./stars";

export const RemotionRoot: FC = () => (
  <>
    <Composition
      id="Launch"
      component={Launch}
      durationInFrames={END}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    {/* The expressions announce. Same stage, same clock, same creature. */}
    <Composition
      id="Expressions"
      component={Expressions}
      durationInFrames={REEL_END}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    {/*
      The endpoint announce. Same stage, and deliberately no clock: what the URL
      returns is a static document, so this is the one composition with nothing
      seeking underneath it.
    */}
    <Composition
      id="Endpoint"
      component={Endpoint}
      durationInFrames={EP_END}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    {/*
      The triangles cut. One shape, one pose, one move — and the only
      composition here that is light, because it is texture rather than an
      announcement and half the tone set vanishes on ink.
    */}
    <Composition
      id="Triangles"
      component={Triangles}
      durationInFrames={TRI_END}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    {/*
      The adapters announce. One import specifier is edited and the creature
      above it does not change — because the frame hands over to a real Vue app
      on the commit, and the two adapters render the same bytes.
    */}
    <Composition
      id="Adapters"
      component={Adapters}
      durationInFrames={SWAP_END}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
    {/*
      The thank-you. The only composition whose crowd is not a list of names
      chosen to make a point — it is the stargazers, and the camera is fitted to
      them rather than authored, so the shot re-cuts itself if the list moves.
    */}
    <Composition
      id="Thanks"
      component={Thanks}
      durationInFrames={STARS_END}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  </>
);
