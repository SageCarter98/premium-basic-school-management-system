/**
 * inventory.service.ts
 *
 * Implements SRS v2.1 Chapter 28 (FR-OPS-050). See 0015_inventory.sql's
 * header for the low-stock alert design (third module to call
 * CommunicationService directly, after Discipline and Health — this one
 * with sensitivity 'normal', not 'confidential').
 *
 * issueStock() locks the item row and rejects when quantity_on_hand is
 * insufficient — the same "lock, check, decrement in one transaction"
 * shape as library.service.ts's issueLoan().
 */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CommunicationService } from '../communication/communication.service';
import { StaffService } from '../staff/staff.service';
import { CreateItemDto } from './dto/create-item.dto';
import { ReceiveStockDto } from './dto/receive-stock.dto';
import { IssueStockDto } from './dto/issue-stock.dto';

export interface InventoryItem {
  id: string;
  tenant_id: string;
  name: string;
  category: string | null;
  unit: string;
  quantity_on_hand: number;
  reorder_threshold: number;
}

export interface InventoryIssuance {
  id: string;
  tenant_id: string;
  item_id: string;
  issued_to_type: string;
  issued_to_id: string;
  quantity: number;
  issued_by: string;
  issued_at: string;
  purpose: string | null;
}

export interface InventoryAlert {
  id: string;
  tenant_id: string;
  item_id: string;
  quantity_on_hand: number;
  reorder_threshold: number;
  notification_id: string | null;
  created_at: string;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly db: TenantDatabaseService,
    private readonly communication: CommunicationService,
    private readonly staff: StaffService,
  ) {}

  async createItem(input: CreateItemDto): Promise<InventoryItem> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<InventoryItem>(
      `insert into inventory_items (tenant_id, name, category, unit, quantity_on_hand, reorder_threshold, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $6, $6)
       returning *`,
      [input.name, input.category ?? null, input.unit ?? 'each', input.quantityOnHand, input.reorderThreshold, userId],
    );
    return rows[0];
  }

  async findAllItems(): Promise<InventoryItem[]> {
    return this.db.query<InventoryItem>(`select * from inventory_items order by name`);
  }

  async findItem(id: string): Promise<InventoryItem> {
    const rows = await this.db.query<InventoryItem>(`select * from inventory_items where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Inventory item ${id} not found`);
    }
    return rows[0];
  }

  async receiveStock(id: string, input: ReceiveStockDto): Promise<InventoryItem> {
    const { userId } = TenantContextStore.current();
    await this.findItem(id);
    const rows = await this.db.query<InventoryItem>(
      `update inventory_items set quantity_on_hand = quantity_on_hand + $1, updated_at = now(), updated_by = $2 where id = $3 returning *`,
      [input.quantity, userId, id],
    );
    return rows[0];
  }

  /** Decrements stock inside a locked transaction, then — if the caller
   * supplied alert-recipient details and the post-issuance level is at or
   * below the reorder threshold — dispatches a 'normal'-sensitivity
   * notification and records the alert (see class header). */
  async issueStock(itemId: string, input: IssueStockDto): Promise<InventoryIssuance> {
    const { userId } = TenantContextStore.current();
    let updatedItem: InventoryItem;
    let issuance: InventoryIssuance;

    // Same reasoning as discipline/health's contactGuardian(): issuedToId
    // is a polymorphic actor id (student|staff) with no DB-level FK
    // possible (see 0018_staff_directory.sql's header), so a 'staff'
    // issuedToType is validated here against the real directory before
    // the row is ever written — communication.createNotification()'s own
    // defense-in-depth check only covers notifyRecipientId, a separate
    // field for the low-stock alert, not this one.
    if (input.issuedToType === 'staff' && !(await this.staff.isRealStaffMember(input.issuedToId))) {
      throw new NotFoundException(`issuedToId ${input.issuedToId} is not a real staff member of this tenant`);
    }

    await this.db.query('BEGIN');
    try {
      const itemRows = await this.db.query<InventoryItem>(`select * from inventory_items where id = $1 for update`, [
        itemId,
      ]);
      if (itemRows.length === 0) {
        throw new NotFoundException(`Inventory item ${itemId} not found`);
      }
      if (itemRows[0].quantity_on_hand < input.quantity) {
        throw new ConflictException(
          `Cannot issue ${input.quantity} of '${itemRows[0].name}': only ${itemRows[0].quantity_on_hand} on hand`,
        );
      }

      const updatedRows = await this.db.query<InventoryItem>(
        `update inventory_items set quantity_on_hand = quantity_on_hand - $1, updated_at = now(), updated_by = $2 where id = $3 returning *`,
        [input.quantity, userId, itemId],
      );
      updatedItem = updatedRows[0];

      const issuanceRows = await this.db.query<InventoryIssuance>(
        `insert into inventory_issuances (tenant_id, item_id, issued_to_type, issued_to_id, quantity, issued_by, purpose)
         values (current_tenant_id(), $1, $2, $3, $4, $5, $6)
         returning *`,
        [itemId, input.issuedToType, input.issuedToId, input.quantity, input.issuedBy, input.purpose ?? null],
      );
      issuance = issuanceRows[0];
      await this.db.query('COMMIT');
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }

    if (updatedItem.quantity_on_hand <= updatedItem.reorder_threshold && input.notifyRecipientId) {
      let notificationId: string | null = null;
      if (input.notifyRecipientEmail || input.notifyRecipientName) {
        const notification = await this.communication.createNotification({
          recipientType: 'staff',
          recipientId: input.notifyRecipientId,
          recipientName: input.notifyRecipientName ?? 'Storekeeper',
          recipientEmail: input.notifyRecipientEmail,
          subject: 'Low stock alert',
          body: `'${updatedItem.name}' is at ${updatedItem.quantity_on_hand} ${updatedItem.unit}, at or below the reorder threshold of ${updatedItem.reorder_threshold}.`,
          sensitivityLevel: 'normal',
        });
        await this.communication.send(notification.id);
        notificationId = notification.id;
      }
      await this.db.query(
        `insert into inventory_alerts (tenant_id, item_id, quantity_on_hand, reorder_threshold, notification_id)
         values (current_tenant_id(), $1, $2, $3, $4)`,
        [itemId, updatedItem.quantity_on_hand, updatedItem.reorder_threshold, notificationId],
      );
    }

    return issuance;
  }

  async findAllIssuances(): Promise<InventoryIssuance[]> {
    return this.db.query<InventoryIssuance>(`select * from inventory_issuances order by issued_at desc`);
  }

  async findAlerts(): Promise<InventoryAlert[]> {
    return this.db.query<InventoryAlert>(`select * from inventory_alerts order by created_at desc`);
  }
}
