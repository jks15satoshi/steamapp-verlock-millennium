import { useEffect, useState } from "react";
import {
  MenuGroup,
  MenuItem,
  afterPatch,
  fakeRenderComponent,
  findInReactTree,
  findInTree,
  findModuleByExport,
} from "millennium";
import type { AppId } from "./index";
import { reapply_all } from "./watch";
import { is_locked, refresh_locked_ids, subscribe_locked } from "./locked";
import { lock_app, refresh_app, unlock_app } from "./actions";

const GROUP_KEY = "steamapp-verlock";

let menu_unpatch: (() => void) | null = null;

function to_appid(value: unknown): AppId | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function is_properties_item(node: unknown): boolean {
  const candidate = node as { props?: { onSelected?: unknown }; onSelected?: unknown } | null;
  const selected = candidate?.props?.onSelected ?? candidate?.onSelected;
  return typeof selected === "function" && selected.toString().includes("AppProperties");
}

function is_app_context_menu(items: unknown): boolean {
  if (!Array.isArray(items) || items.length === 0) {
    return false;
  }
  return Boolean(
    findInReactTree(items, (node: unknown) => {
      const candidate = node as {
        app?: { appid?: unknown };
        props?: { app?: { appid?: unknown } };
      } | null;
      return (
        is_properties_item(node) ||
        candidate?.app?.appid !== undefined ||
        candidate?.props?.app?.appid !== undefined
      );
    }),
  );
}

function find_context_menu_appid(tree: unknown, owner: unknown): AppId | undefined {
  const owner_appid = to_appid(
    (owner as { pendingProps?: { overview?: { appid?: unknown } } } | null)?.pendingProps?.overview
      ?.appid,
  );
  if (owner_appid !== undefined) {
    return owner_appid;
  }

  const found = findInTree(
    tree,
    (node: unknown) => {
      const candidate = node as {
        app?: { appid?: unknown };
        overview?: { appid?: unknown };
      } | null;
      return candidate?.app?.appid !== undefined || candidate?.overview?.appid !== undefined;
    },
    { walkable: ["props", "children", "_owner", "pendingProps"] },
  ) as { app?: { appid?: unknown }; overview?: { appid?: unknown } } | null;

  return to_appid(found?.app?.appid ?? found?.overview?.appid);
}

function LockedMenuGroup({ appid }: { appid: AppId }) {
  const [locked, set_locked] = useState<boolean>(() => is_locked(appid));

  useEffect(() => {
    const update = (): void => {
      set_locked(is_locked(appid));
    };
    update();
    const unsubscribe = subscribe_locked(update);
    void refresh_locked_ids();
    return unsubscribe;
  }, [appid]);

  return (
    <MenuGroup label="Steam App Verlock">
      <MenuItem key={`${GROUP_KEY}-state`} disabled>
        {locked ? "Locked" : "Not locked"}
      </MenuItem>
      <MenuItem
        key={`${GROUP_KEY}-lock`}
        disabled={locked}
        onSelected={() => {
          void lock_app(appid, window);
        }}
      >
        Lock
      </MenuItem>
      <MenuItem
        key={`${GROUP_KEY}-refresh`}
        disabled={!locked}
        onSelected={() => {
          void refresh_app(appid, window);
        }}
      >
        Refresh
      </MenuItem>
      <MenuItem
        key={`${GROUP_KEY}-unlock`}
        disabled={!locked}
        onSelected={() => {
          void unlock_app(appid, window);
        }}
      >
        Unlock
      </MenuItem>
    </MenuGroup>
  );
}

function insert_menu_group(items: unknown[], appid: AppId): boolean {
  if (items.some((item) => (item as { key?: unknown } | null)?.key === GROUP_KEY)) {
    return false;
  }

  const properties_index = items.findIndex((item) =>
    Boolean(findInReactTree([item], is_properties_item)),
  );
  const group = <LockedMenuGroup key={GROUP_KEY} appid={appid} />;
  if (properties_index === -1) {
    items.push(group);
  } else {
    items.splice(properties_index, 0, group);
  }

  void refresh_locked_ids();
  void reapply_all();
  return true;
}

export function install_menu_patch(): () => void {
  if (menu_unpatch) {
    return menu_unpatch;
  }

  const attempt = (): boolean => {
    const module = findModuleByExport((exported: unknown) =>
      Boolean(
        (exported as { toString?: () => string } | null)
          ?.toString?.()
          .includes("().LibraryContextMenu"),
      ),
    );
    if (!module) {
      return false;
    }

    const component: any = Object.values(module).find((sibling: unknown) =>
      (sibling as { toString?: () => string } | null)?.toString?.().includes("navigator:"),
    );
    const library_context_menu = component ? (fakeRenderComponent(component)?.type as any) : null;
    if (!library_context_menu?.prototype?.render) {
      return false;
    }

    let inner_patch: { unpatch(): void } | null = null;

    const outer_patch = afterPatch(
      library_context_menu.prototype,
      "render",
      (_args: any[], rendered: any) => {
        if (!inner_patch) {
          inner_patch = afterPatch(rendered, "type", (_type_args: any[], type_ret: any) => {
            if (type_ret?.type?.prototype?.render) {
              afterPatch(
                type_ret.type.prototype,
                "render",
                (_render_args: any[], render_ret: any) => {
                  const menu_items = render_ret?.props?.children?.[0];
                  if (Array.isArray(menu_items) && is_app_context_menu(menu_items)) {
                    const appid = find_context_menu_appid(render_ret, render_ret?._owner);
                    if (appid) {
                      void refresh_locked_ids();
                      insert_menu_group(menu_items, appid);
                    }
                  }
                  return render_ret;
                },
              );

              afterPatch(
                type_ret.type.prototype,
                "shouldComponentUpdate",
                ([next_props]: any[], should_update: any) => {
                  const menu_items = next_props?.children;
                  if (Array.isArray(menu_items) && is_app_context_menu(menu_items)) {
                    const appid = find_context_menu_appid(next_props, undefined);
                    if (appid && insert_menu_group(menu_items, appid)) {
                      return true;
                    }
                  }
                  return should_update;
                },
              );
            }
            return type_ret;
          });
        } else if (Array.isArray(rendered?.props?.children)) {
          const appid = find_context_menu_appid(rendered, rendered?._owner);
          if (appid) {
            insert_menu_group(rendered.props.children, appid);
          }
        }

        return rendered;
      },
    );

    menu_unpatch = () => {
      outer_patch?.unpatch?.();
      inner_patch?.unpatch?.();
    };
    return true;
  };

  let retry_timer: ReturnType<typeof setInterval> | null = null;
  const stop_retry = () => {
    if (retry_timer !== null) {
      clearInterval(retry_timer);
      retry_timer = null;
    }
  };

  if (!attempt()) {
    retry_timer = setInterval(() => {
      if (attempt()) {
        stop_retry();
      }
    }, 5000);
  }

  return () => {
    stop_retry();
    menu_unpatch?.();
    menu_unpatch = null;
  };
}
