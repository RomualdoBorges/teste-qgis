const paths: Record<string, string> = {
  pan: "M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1V4.5a1.5 1.5 0 0 1 3 0V11m0-.5V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.6 13.6a1.5 1.5 0 0 1 2.4-1.8L9 15V8.5a1.5 1.5 0 0 1 3 0",
  info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Zm0-11v6m0-10h.01",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  extent: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  layers: "m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5",
  chevron: "m9 6 6 6-6 6",
  expand: "M7 10l5 5 5-5M7 4l5 5 5-5",
  collapse: "M7 14l5-5 5 5M7 20l5-5 5 5",
  uncheck: "M4 4h16v16H4zM9 9l6 6m0-6-6 6",
  close: "M6 6l12 12M18 6 6 18",
  zoomTo: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35M8 11h6M11 8v6",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z",
  warning: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
  filter: "M4 5h16l-6 8v6l-4-2v-4L4 5Z",
  inventory: "M9 5h11M9 12h11M9 19h11M4 5h.01M4 12h.01M4 19h.01",
  refresh: "M20 11a8 8 0 0 0-14.9-3.9M4 5v4h4M4 13a8 8 0 0 0 14.9 3.9M20 19v-4h-4",
  draw: "M4 18 9 6l6 9 5-5M4 18h.01M9 6h.01M15 15h.01M20 10h.01",
  download: "M12 4v11m-5-5 5 5 5-5M5 20h14",
  print: "M7 8V3h10v5M7 17H4v-7h16v7h-3M7 14h10v7H7z",
  back: "M15 6l-6 6 6 6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35",
  report: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  expandView: "M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7",
  select: "M4 4h4M4 4v4M20 4h-4M20 4v4M4 20h4M4 20v-4M20 20h-4M20 20v-4M9 12h6M12 9v6",
};

export type IconName = keyof typeof paths;

export default function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
