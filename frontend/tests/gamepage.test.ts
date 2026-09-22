import { expect, mock, test } from "bun:test";
import { millennium_mock } from "./millennium_mock";

void mock.module("react", () => ({
  useEffect: () => {},
  useState: (initial: unknown) =>
    typeof initial === "function" ? [(initial as () => unknown)(), () => {}] : [initial, () => {}],
}));

void mock.module("react/jsx-runtime", () => ({
  Fragment: Symbol("Fragment"),
  jsx: () => null,
  jsxs: () => null,
}));

void mock.module("react-dom/client", () => ({
  createRoot: () => ({ render: () => {}, unmount: () => {} }),
}));

void mock.module("millennium", () => millennium_mock());

const { appid_from_image_src, appid_from_path, merge_style } = await import("../gamepage");

test("appid_from_path reads the app id from a library game path", () => {
  expect(appid_from_path("/library/app/413150")).toBe("413150");
  expect(appid_from_path("/app/440")).toBe("440");
  expect(appid_from_path("/library/home")).toBeUndefined();
  expect(appid_from_path("")).toBeUndefined();
});

test("appid_from_image_src reads the app id from a hero image url", () => {
  expect(
    appid_from_image_src(
      "https://cdn.cloudflare.steamstatic.com/steam/apps/1222670/library_hero.jpg",
    ),
  ).toBe("1222670");
  expect(appid_from_image_src("https://cdn.example.com/assets/413150/hero.png")).toBe("413150");
  expect(appid_from_image_src("https://cdn.example.com/nothing.png")).toBeUndefined();
});

test("merge_style fills each absent sampled field from the fallback", () => {
  const fallback = {
    label: { color: "label-color", fontSize: "12px" },
    value: { color: "value-color" },
    icon: { color: "icon-color", width: "20px", height: "20px", opacity: 1 },
  };
  expect(merge_style(null, fallback)).toEqual(fallback);
  expect(
    merge_style(
      {
        label: { color: "sampled-label" },
        icon: { color: "sampled-icon", width: "10px", height: "10px" },
      },
      fallback,
    ),
  ).toEqual({
    label: { color: "sampled-label", fontSize: "12px" },
    value: { color: "value-color" },
    icon: { color: "sampled-icon", width: "10px", height: "10px", opacity: 1 },
  });
});
