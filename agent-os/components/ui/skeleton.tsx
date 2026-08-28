"use client";

import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface ShimmeringLoaderProps {
  className?: string;
  delayIndex?: number;
  animationDelay?: number;
}

export const ShimmeringLoader = forwardRef<
  HTMLDivElement,
  ShimmeringLoaderProps
>(({ className, delayIndex = 0, animationDelay = 150 }, ref) => {
  return (
    <div
      ref={ref}
      className={cn("shimmer h-3 rounded-full", className)}
      style={{
        animationFillMode: "backwards",
        animationDelay: `${delayIndex * animationDelay}ms`,
      }}
    />
  );
});
ShimmeringLoader.displayName = "ShimmeringLoader";

interface GenericSkeletonLoaderProps {
  className?: string;
}

export function GenericSkeletonLoader({
  className,
}: GenericSkeletonLoaderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      <ShimmeringLoader />
      <ShimmeringLoader className="w-3/4" />
      <ShimmeringLoader className="w-1/2" />
    </div>
  );
}

interface TerminalCardSkeletonProps {
  count?: number;
}

export function TerminalCardSkeleton({ count = 3 }: TerminalCardSkeletonProps) {
  return (
    <div className="flex flex-col gap-1 p-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-2 py-2">
          <ShimmeringLoader className="h-2 w-2 rounded-full" delayIndex={i} />
          <div className="flex-1 space-y-1.5">
            <ShimmeringLoader className="h-3 w-32" delayIndex={i} />
            <ShimmeringLoader className="h-2 w-20" delayIndex={i} />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ProjectSectionSkeletonProps {
  count?: number;
}

export function ProjectSectionSkeleton({
  count = 2,
}: ProjectSectionSkeletonProps) {
  return (
    <div className="space-y-4 p-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-2">
          <div className="flex items-center gap-2 px-2">
            <ShimmeringLoader className="h-3 w-3" delayIndex={i} />
            <ShimmeringLoader className="h-3 w-24" delayIndex={i} />
          </div>
          <TerminalCardSkeleton count={2} />
        </div>
      ))}
    </div>
  );
}

interface DevServerSkeletonProps {
  count?: number;
}

export function DevServerSkeleton({ count = 2 }: DevServerSkeletonProps) {
  return (
    <div className="flex flex-col gap-1 p-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center justify-between px-2 py-2">
          <div className="flex items-center gap-3">
            <ShimmeringLoader className="h-2 w-2 rounded-full" delayIndex={i} />
            <ShimmeringLoader className="h-3 w-24" delayIndex={i} />
          </div>
          <ShimmeringLoader className="h-5 w-16 rounded-full" delayIndex={i} />
        </div>
      ))}
    </div>
  );
}
