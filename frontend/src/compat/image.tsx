import type { ImgHTMLAttributes } from "react";

interface ImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  width?: number | string;
  height?: number | string;
  priority?: boolean;
}

/** The reference uses next/image only for a fixed-size local brand mark. */
export default function Image({ priority: _priority, ...props }: ImageProps) {
  return <img {...props} />;
}
