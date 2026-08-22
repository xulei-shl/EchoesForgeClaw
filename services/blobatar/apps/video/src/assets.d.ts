// Font imports resolve to URLs through the bundler's asset handling.
declare module "*.woff2" {
  const url: string;
  export default url;
}
