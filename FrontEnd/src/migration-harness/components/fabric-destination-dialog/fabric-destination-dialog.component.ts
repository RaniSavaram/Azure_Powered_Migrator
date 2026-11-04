import { Component, EventEmitter, Output, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Scanner, FabricConnectionDetails } from '../../../app/services/scanner/scanner';

const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Asks for the destination Microsoft Fabric workspace (workspace, tenant,
 * service principal, Lakehouse and Warehouse) when the Artifacts Generator
 * conversation starts. Validates it via Django's connect_fabric view and
 * stores it as the Scanner's fabricDestination, which Generate Artifacts
 * deploys into once a scan completes.
 */
@Component({
  selector: 'app-fabric-destination-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './fabric-destination-dialog.component.html',
  styleUrl: './fabric-destination-dialog.component.css'
})
export class FabricDestinationDialogComponent {
  private scanner = inject(Scanner);

  @Output() connected = new EventEmitter<FabricConnectionDetails>();
  @Output() cancelled = new EventEmitter<void>();

  /** Deployment targets offered in the first step. Only Fabric for now. */
  readonly destinations = [{ value: 'fabric', label: 'Microsoft Fabric' }] as const;
  destination: '' | 'fabric' = '';

  get destinationLabel(): string {
    return this.destinations.find(d => d.value === this.destination)?.label ?? 'Destination';
  }

  onDestinationChange(): void {
    this.error.set(null);
  }

  form: FabricConnectionDetails = this.scanner.getFabricDestination() ?? {
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
  rememberMe = true;
  showAdvanced = !!(this.form.lakehouseName || this.form.warehouseName || this.form.warehouseHost);

  connecting = signal(false);
  error = signal<string | null>(null);
  result = signal<{ message: string; workspaceName?: string; lakehouseName?: string; warehouseName?: string } | null>(null);

  get isServicePrincipal(): boolean {
    return (this.form.authMode || 'servicePrincipal') === 'servicePrincipal';
  }

  private validate(): string | null {
    if (!this.destination) return 'Please select your destination.';
    const f = this.form;
    if (!f.workspaceId?.trim()) return 'Workspace ID is required.';
    if (this.isServicePrincipal && (!f.tenantId?.trim() || !f.clientId?.trim() || !f.clientSecret?.trim())) {
      return 'Tenant ID, Client ID and Client Secret are required for Service Principal authentication.';
    }
    const guids: Array<[string, string | undefined]> = [
      ['Workspace ID', f.workspaceId],
      ['Tenant ID', f.tenantId],
      ['Lakehouse ID', f.lakehouseId],
      ['Warehouse ID', f.warehouseId]
    ];
    for (const [label, value] of guids) {
      if (value?.trim() && !GUID_PATTERN.test(value.trim())) return `${label} must be a GUID.`;
    }
    return null;
  }

  submit(): void {
    const problem = this.validate();
    if (problem) {
      this.error.set(problem);
      return;
    }

    const trimmed: FabricConnectionDetails = Object.fromEntries(
      Object.entries(this.form).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
    ) as unknown as FabricConnectionDetails;

    this.error.set(null);
    this.connecting.set(true);
    this.scanner.connectFabric(trimmed, this.rememberMe).subscribe({
      next: (res) => {
        const destination: FabricConnectionDetails = {
          ...trimmed,
          lakehouseName: trimmed.lakehouseName || res.details?.lakehouse_name || '',
          warehouseName: trimmed.warehouseName || res.details?.warehouse_name || ''
        };
        this.scanner.setFabricDestination(destination, this.rememberMe);
        this.connecting.set(false);
        this.result.set({
          message: res.message,
          workspaceName: res.details?.workspace_name,
          lakehouseName: destination.lakehouseName,
          warehouseName: destination.warehouseName
        });
      },
      error: (err) => {
        this.connecting.set(false);
        this.error.set(
          err.error?.message || err.message || 'Could not connect to Microsoft Fabric. Check the IDs and credentials.'
        );
      }
    });
  }

  done(): void {
    const destination = this.scanner.getFabricDestination();
    if (destination) this.connected.emit(destination);
  }

  cancel(): void {
    if (this.connecting()) return;
    this.cancelled.emit();
  }
}
