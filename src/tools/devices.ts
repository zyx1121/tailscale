import { z } from "zod";
import { fail, ok } from "../core/result.ts";
import { defineTool, type ToolboxTool } from "../core/tool.ts";
import type { TailscaleClient } from "../tailscale/client.ts";

/** A device as the API returns it with `fields=all`. Only the keys this module reads are typed. */
export interface ApiDevice {
  id?: string;
  nodeId?: string;
  name?: string;
  hostname?: string;
  addresses?: string[];
  os?: string;
  user?: string;
  tags?: string[];
  connectedToControl?: boolean;
  lastSeen?: string;
  authorized?: boolean;
  expires?: string;
  keyExpiryDisabled?: boolean;
  advertisedRoutes?: string[];
  enabledRoutes?: string[];
  updateAvailable?: boolean;
  clientVersion?: string;
  isExternal?: boolean;
  [key: string]: unknown;
}

export function summarise(device: ApiDevice) {
  return {
    id: device.nodeId ?? device.id ?? "",
    name: device.name ?? "",
    hostname: device.hostname ?? "",
    addresses: device.addresses ?? [],
    os: device.os ?? "",
    user: device.user ?? "",
    tags: device.tags ?? [],
    online: device.connectedToControl ?? null,
    last_seen: device.lastSeen ?? null,
    authorized: device.authorized ?? null,
    key_expires: device.keyExpiryDisabled ? null : (device.expires ?? null),
    advertised_routes: device.advertisedRoutes ?? [],
    enabled_routes: device.enabledRoutes ?? [],
    update_available: device.updateAvailable ?? false,
    client_version: device.clientVersion ?? "",
    external: device.isExternal ?? false,
  };
}

export interface DeviceFilter {
  query?: string;
  tag?: string;
  online?: boolean;
}

export function matchesFilter(device: ApiDevice, filter: DeviceFilter): boolean {
  if (filter.online !== undefined && (device.connectedToControl ?? false) !== filter.online) return false;

  if (filter.tag) {
    const wanted = filter.tag.startsWith("tag:") ? filter.tag : `tag:${filter.tag}`;
    if (!(device.tags ?? []).includes(wanted)) return false;
  }

  if (filter.query) {
    const needle = filter.query.toLowerCase();
    const haystack = [device.name, device.hostname, device.user, device.os, ...(device.addresses ?? [])];
    if (!haystack.some((field) => field?.toLowerCase().includes(needle))) return false;
  }

  return true;
}

/** Exact matches only: an ID, the full or short MagicDNS name, the hostname, or a tailnet address. */
export function findDevices(devices: ApiDevice[], selector: string): ApiDevice[] {
  const wanted = selector.trim().toLowerCase();
  return devices.filter((device) => {
    const name = device.name?.toLowerCase() ?? "";
    const candidates = [device.nodeId, device.id, name, name.split(".")[0], device.hostname, ...(device.addresses ?? [])];
    return candidates.some((candidate) => candidate?.toLowerCase() === wanted);
  });
}

async function fetchDevices(client: TailscaleClient): Promise<ApiDevice[]> {
  const response = await client.request(`${client.tailnetPath("devices")}?fields=all`);
  const parsed = JSON.parse(response.text) as { devices?: ApiDevice[] };
  return parsed.devices ?? [];
}

const summarySchema = z.looseObject({
  id: z.string().describe("Stable node ID. Pass it to tailscale_get_device."),
  name: z.string().describe("MagicDNS name."),
  hostname: z.string(),
  addresses: z.array(z.string()),
  os: z.string(),
  user: z.string(),
  tags: z.array(z.string()),
  online: z.boolean().nullable().describe("Connected to the control plane right now."),
  last_seen: z.string().nullable(),
  authorized: z.boolean().nullable(),
  key_expires: z.string().nullable().describe("Null when key expiry is disabled."),
  advertised_routes: z.array(z.string()),
  enabled_routes: z.array(z.string()),
  update_available: z.boolean(),
  client_version: z.string(),
  external: z.boolean().describe("Shared in from another tailnet."),
});

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function deviceTools(client: TailscaleClient): ToolboxTool[] {
  return [
    defineTool({
      name: "tailscale_list_devices",
      description:
        "List the devices in the tailnet: node ID, MagicDNS name, addresses, OS, owner, tags, online state, last seen, key expiry and subnet routes. Filter by text, tag or online state. Read-only.",
      inputSchema: {
        query: z.string().optional().describe("Case-insensitive text matched against name, hostname, owner, OS and addresses."),
        tag: z.string().optional().describe('Keep devices with this tag. "server" and "tag:server" both work.'),
        online: z.boolean().optional().describe("true keeps connected devices, false keeps disconnected ones."),
        limit: z.number().int().min(1).max(1000).optional().describe("Maximum devices to return. Default: 200."),
      },
      data: z.looseObject({
        devices: z.array(summarySchema),
        matched: z.number().describe("Devices that passed the filters, before the limit."),
        total: z.number().describe("Devices in the tailnet."),
      }),
      annotations: readOnly,
      async handler(input) {
        const devices = await fetchDevices(client);
        const matched = devices.filter((device) => matchesFilter(device, input));
        const limit = input.limit ?? 200;
        return ok({ devices: matched.slice(0, limit).map(summarise), matched: matched.length, total: devices.length });
      },
    }),
    defineTool({
      name: "tailscale_get_device",
      description:
        "Get every field of one device: keys, client connectivity, posture, routes and tailnet lock state. Select it by node ID, MagicDNS name (full or short), hostname or tailnet address. Read-only.",
      inputSchema: {
        device: z.string().min(1).describe("Node ID, MagicDNS name, hostname or tailnet IP. Must match exactly one device."),
      },
      data: z.looseObject({ device: z.record(z.string(), z.unknown()) }),
      annotations: readOnly,
      async handler(input) {
        const found = findDevices(await fetchDevices(client), input.device);
        if (found.length === 0) {
          return fail({
            code: "not_found",
            message: `No device matches "${input.device}".`,
            hint: "Call tailscale_list_devices with query to find the node ID.",
          });
        }
        if (found.length > 1) {
          const candidates = found.map((device) => `${device.nodeId ?? device.id} (${device.name})`).join(", ");
          return fail({
            code: "ambiguous",
            message: `"${input.device}" matches ${found.length} devices.`,
            why: candidates,
            hint: "Select the device by node ID.",
          });
        }
        return ok({ device: found[0] });
      },
    }),
  ];
}
