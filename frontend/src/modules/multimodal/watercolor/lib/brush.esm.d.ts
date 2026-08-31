export const Color: any;
export const DEGREES: string;
export const RADIANS: string;
export const Plot: any;
export const Polygon: any;
export const Position: any;

export function load(target?: any): void;
export function createCanvas(width: number, height: number, options?: any): HTMLCanvasElement;
export function clear(r?: number, g?: number, b?: number, a?: number): void;
export function render(): void;
export function seed(s: number): void;
export function noiseSeed(s: number): void;
export function random(min?: any, max?: any): any;
export function noise(x: number, y?: number): number;

export function field(name: string): void;
export function noField(): void;
export function addField(name: string, gen: any, options?: any): void;
export function listFields(): string[];
export function refreshField(t?: number): void;
export function wiggle(amount?: number): void;

export function set(brushName: string, color: string | any, weight?: number): void;
export function pick(name: string): void;
export function stroke(r: any, g?: number, b?: number): void;
export function strokeWeight(weight: number): void;
export function noStroke(): void;
export function box(): string[];
export function add(name: string, params: any): any;

export function fill(color?: any, opacity?: number): void;
export function fillBleed(strength: number, direction?: string, angle?: number | null): void;
export function fillTexture(texture?: number, border?: number, scatter?: boolean): void;
export function noFill(): void;

export function wash(color?: any, opacity?: number): void;
export function noWash(): void;

export function hatch(dist?: number, angle?: number, options?: any): void;
export function hatchStyle(brush: string, color?: any, weight?: number): void;
export function hatchArray(polygons: any[]): void;
export function noHatch(): void;

export function mass(brush: string, color: any, options?: any): void;
export function massArray(polygons: any[]): void;
export function noMass(): void;

export function line(x1: number, y1: number, x2: number, y2: number): void;
export function flowLine(x: number, y: number, length: number, dir: number): void;
export function rect(x: number, y: number, w: number, h: number, mode?: string): void;
export function circle(x: number, y: number, r: number, rough?: number): void;
export function arc(x: number, y: number, r: number, startAngle: number, endAngle: number): void;
export function polygon(verts: [number, number][]): any;
export function spline(pts: [number, number, number?][], tension?: number): any;

export function beginShape(curvature?: number): void;
export function vertex(x: number, y: number, pressure?: number): void;
export function endShape(close?: boolean): any;

export function beginStroke(type: string, x: number, y: number): void;
export function move(angle: number, length: number, pressure?: number): void;
export function endStroke(angle?: number, pressure?: number): void;

export function push(): void;
export function pop(): void;
export function translate(x: number, y: number): void;
export function rotate(deg: number): void;
export function scale(sx: number, sy?: number): void;
export function scaleBrushes(scale: number): void;
export function angleMode(mode: string): void;
export function getAngleMode(): string;
export function clip(region: number[]): number[];
export function noClip(): void;
