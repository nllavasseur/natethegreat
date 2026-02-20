import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Vasseur Estimator",
    short_name: "Estimator",
    description: "Vasseur Estimator",
    start_url: "/estimates",
    scope: "/",
    display: "standalone",
    background_color: "#9C621F",
    theme_color: "#1F4D3A",
    icons: [
      {
        src: "/IMG_3454.JPG",
        sizes: "192x192",
        type: "image/jpeg"
      },
      {
        src: "/IMG_3454.JPG",
        sizes: "512x512",
        type: "image/jpeg"
      }
    ]
  };
}
