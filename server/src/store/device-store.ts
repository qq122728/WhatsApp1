export type DeviceConnectionStatus =
  | "offline"
  | "starting"
  | "ready"
  | "degraded"
  | "busy"
  | "shutting_down";

export interface DeviceRegistration {
  deviceId: string;
  name: string;
  clientVersion?: string;
  capabilities: string[];
  protocolVersion: 1;
}

export interface DeviceRecord extends DeviceRegistration {
  credentialHash: string;
  credentialExpiresAt: string;
  registeredAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  connectedAt?: string;
  disconnectedAt?: string;
  connectionId?: string;
  statusRevision?: number;
  status: DeviceConnectionStatus;
  statusReason?: string;
}

export type PublicDevice = Omit<DeviceRecord, "credentialHash">;

function withoutCredential(record: DeviceRecord): PublicDevice {
  const { credentialHash: _credentialHash, ...publicRecord } = record;
  return structuredClone(publicRecord);
}

/**
 * Development-only volatile storage.
 * All registrations, credential hashes, statuses and command state disappear
 * on process restart. Replace this implementation before production use.
 */
export class InMemoryDeviceStore {
  private readonly devices = new Map<string, DeviceRecord>();

  register(
    registration: DeviceRegistration,
    credentialHash: string,
    credentialExpiresAt: string,
  ): PublicDevice {
    const now = new Date().toISOString();
    const record: DeviceRecord = {
      ...registration,
      credentialHash,
      credentialExpiresAt,
      registeredAt: now,
      updatedAt: now,
      status: "offline",
      statusReason: "REGISTERED",
    };
    this.devices.set(record.deviceId, record);
    return withoutCredential(record);
  }

  get(deviceId: string): DeviceRecord | undefined {
    const record = this.devices.get(deviceId);
    return record === undefined ? undefined : structuredClone(record);
  }

  list(): PublicDevice[] {
    return [...this.devices.values()]
      .map(withoutCredential)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  updateConnection(
    deviceId: string,
    update: {
      status: DeviceConnectionStatus;
      statusReason: string;
      connectionId?: string;
      connectedAt?: string;
      disconnectedAt?: string;
      lastSeenAt?: string;
    },
  ): PublicDevice | undefined {
    const record = this.devices.get(deviceId);
    if (record === undefined) {
      return undefined;
    }
    const now = new Date().toISOString();
    Object.assign(record, update, { updatedAt: now });
    if (
      update.connectionId === undefined &&
      (update.status === "offline" || update.status === "starting")
    ) {
      delete record.connectionId;
    }
    return withoutCredential(record);
  }

  touch(
    deviceId: string,
    status?: DeviceConnectionStatus,
    statusReason?: string,
  ): PublicDevice | undefined {
    const record = this.devices.get(deviceId);
    if (record === undefined) {
      return undefined;
    }
    const now = new Date().toISOString();
    record.lastSeenAt = now;
    record.updatedAt = now;
    if (status !== undefined) {
      record.status = status;
    }
    if (statusReason !== undefined) {
      record.statusReason = statusReason;
    }
    return withoutCredential(record);
  }

  updateReportedStatus(
    deviceId: string,
    update: {
      connectionId: string;
      statusRevision: number;
      status: Exclude<DeviceConnectionStatus, "offline">;
    },
  ): { device: PublicDevice; applied: boolean } | undefined {
    const record = this.devices.get(deviceId);
    if (record === undefined) {
      return undefined;
    }

    const now = new Date().toISOString();
    const currentRevision = record.statusRevision ?? 0;
    const applied = update.statusRevision > currentRevision;
    record.lastSeenAt = now;
    record.updatedAt = now;
    record.connectionId = update.connectionId;
    if (applied) {
      record.statusRevision = update.statusRevision;
      record.status = update.status;
      record.statusReason = "DEVICE_REPORTED";
    }
    return { device: withoutCredential(record), applied };
  }
}
