import { FabricConnectionDetails } from '../../app/services/scanner/scanner';

export const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns a blank Microsoft Fabric destination form object. */
export function emptyFabricDestinationForm(): FabricConnectionDetails {
  return {
    workspaceId: '',
    tenantId: '',
    clientId: '',
    clientSecret: '',
    lakehouseId: '',
    lakehouseName: '',
    warehouseId: '',
    warehouseName: '',
    warehouseHost: '',
    authMode: 'servicePrincipal'
  };
}

/** Validates Microsoft Fabric destination fields and returns per-field flags plus error summary. */
export function validateFabricDestination(form: FabricConnectionDetails): {
  errors: Record<string, boolean>;
  message: string | null;
} {
  const errors: Record<string, boolean> = {};
  const isSp = (form.authMode || 'servicePrincipal') === 'servicePrincipal';

  if (!form.workspaceId?.trim()) errors['workspaceId'] = true;
  if (isSp) {
    if (!form.tenantId?.trim()) errors['tenantId'] = true;
    if (!form.clientId?.trim()) errors['clientId'] = true;
    if (!form.clientSecret?.trim()) errors['clientSecret'] = true;
  }

  for (const key of ['workspaceId', 'tenantId', 'lakehouseId', 'warehouseId'] as const) {
    const value = (form[key] || '').trim();
    if (value && !GUID_PATTERN.test(value)) errors[key] = true;
  }

  const message = Object.keys(errors).length
    ? 'Please fix the highlighted fields. IDs must be GUIDs like 00000000-0000-0000-0000-000000000000.'
    : null;
  return { errors, message };
}

/** Trims string values on a FabricConnectionDetails object before submission. */
export function trimFabricDestination(form: FabricConnectionDetails): FabricConnectionDetails {
  return Object.fromEntries(
    Object.entries(form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
  ) as unknown as FabricConnectionDetails;
}

/** Formats confirmed destination details into display rows for chat messages. */
export function buildFabricSummaryRows(
  d: FabricConnectionDetails,
  workspaceName?: string | null
): Array<{ label: string; value: string }> {
  return [
    { label: 'Destination', value: 'Microsoft Fabric' },
    { label: 'Workspace', value: workspaceName ? `${workspaceName} (${d.workspaceId})` : d.workspaceId },
    { label: 'Tenant', value: d.tenantId || 'Default Azure credential' },
    { label: 'Lakehouse', value: d.lakehouseName || d.lakehouseId || 'Auto-created per source' },
    { label: 'Warehouse', value: d.warehouseName || d.warehouseId || d.warehouseHost || 'Not configured' }
  ];
}

