declare module "*.jpg" {
  const image: { src: string; width: number; height: number };
  export default image;
}

declare module "*.jpeg" {
  const image: { src: string; width: number; height: number };
  export default image;
}
