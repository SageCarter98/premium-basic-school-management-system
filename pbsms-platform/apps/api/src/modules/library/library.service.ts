/**
 * library.service.ts
 *
 * Implements SRS v2.1 Chapter 28 (FR-OPS-010). See 0012_library.sql's
 * header for the polymorphic library_members design and the fixed-rate
 * fine simplification.
 *
 * issueLoan() locks the item row and rejects when available_copies is
 * already 0 — the same "lock, check, decrement in one transaction" shape
 * as finance.service.ts's allocate()/approveAssistance() balance guards.
 */

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantDatabaseService } from '../../common/database/tenant-database.service';
import { TenantContextStore } from '../../common/tenant/tenant-context';
import { CreateItemDto } from './dto/create-item.dto';
import { CreateMemberDto } from './dto/create-member.dto';
import { IssueLoanDto } from './dto/issue-loan.dto';

export interface LibraryItem {
  id: string;
  tenant_id: string;
  title: string;
  author: string | null;
  isbn: string | null;
  category: string | null;
  total_copies: number;
  available_copies: number;
}

export interface LibraryMember {
  id: string;
  tenant_id: string;
  student_id: string | null;
  staff_user_id: string | null;
}

export interface LibraryLoan {
  id: string;
  tenant_id: string;
  item_id: string;
  member_id: string;
  issued_at: string;
  due_date: string;
  returned_at: string | null;
  renewal_count: number;
  fine_amount: string;
  fine_paid: boolean;
  status: string;
}

/** Fixed policy constants — no configurable per-tenant circulation policy
 * exists yet (see class header). */
const DAILY_FINE_RATE = 1.0; // GHS per day overdue
const RENEWAL_EXTENSION_DAYS = 14;

@Injectable()
export class LibraryService {
  constructor(private readonly db: TenantDatabaseService) {}

  // ---------------------------------------------------------------------
  // Catalogue
  // ---------------------------------------------------------------------

  async createItem(input: CreateItemDto): Promise<LibraryItem> {
    const { userId } = TenantContextStore.current();
    const rows = await this.db.query<LibraryItem>(
      `insert into library_items (tenant_id, title, author, isbn, category, total_copies, available_copies, created_by, updated_by)
       values (current_tenant_id(), $1, $2, $3, $4, $5, $5, $6, $6)
       returning *`,
      [input.title, input.author ?? null, input.isbn ?? null, input.category ?? null, input.totalCopies, userId],
    );
    return rows[0];
  }

  async findAllItems(): Promise<LibraryItem[]> {
    return this.db.query<LibraryItem>(`select * from library_items order by title`);
  }

  async findItem(id: string): Promise<LibraryItem> {
    const rows = await this.db.query<LibraryItem>(`select * from library_items where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Library item ${id} not found`);
    }
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // Members
  // ---------------------------------------------------------------------

  async createMember(input: CreateMemberDto): Promise<LibraryMember> {
    const { userId } = TenantContextStore.current();
    if (!!input.studentId === !!input.staffUserId) {
      throw new BadRequestException('createMember requires exactly one of studentId or staffUserId');
    }
    const rows = await this.db.query<LibraryMember>(
      `insert into library_members (tenant_id, student_id, staff_user_id, created_by)
       values (current_tenant_id(), $1, $2, $3)
       returning *`,
      [input.studentId ?? null, input.staffUserId ?? null, userId],
    );
    return rows[0];
  }

  async findAllMembers(): Promise<LibraryMember[]> {
    return this.db.query<LibraryMember>(`select * from library_members order by created_at desc`);
  }

  async findMember(id: string): Promise<LibraryMember> {
    const rows = await this.db.query<LibraryMember>(`select * from library_members where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Library member ${id} not found`);
    }
    return rows[0];
  }

  // ---------------------------------------------------------------------
  // Circulation (FR-OPS-010: issue/return/renew/fine)
  // ---------------------------------------------------------------------

  async issueLoan(input: IssueLoanDto): Promise<LibraryLoan> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const itemRows = await this.db.query<LibraryItem>(`select * from library_items where id = $1 for update`, [
        input.itemId,
      ]);
      if (itemRows.length === 0) {
        throw new NotFoundException(`Library item ${input.itemId} not found`);
      }
      if (itemRows[0].available_copies <= 0) {
        throw new ConflictException(`Cannot issue loan: '${itemRows[0].title}' has no available copies`);
      }

      await this.db.query(
        `update library_items set available_copies = available_copies - 1, updated_at = now(), updated_by = $1 where id = $2`,
        [userId, input.itemId],
      );
      const rows = await this.db.query<LibraryLoan>(
        `insert into library_loans (tenant_id, item_id, member_id, due_date, created_by, updated_by)
         values (current_tenant_id(), $1, $2, $3, $4, $4)
         returning *`,
        [input.itemId, input.memberId, input.dueDate, userId],
      );
      await this.db.query('COMMIT');
      return rows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async findLoan(id: string): Promise<LibraryLoan> {
    const rows = await this.db.query<LibraryLoan>(`select * from library_loans where id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException(`Library loan ${id} not found`);
    }
    return rows[0];
  }

  async findAllLoans(): Promise<LibraryLoan[]> {
    return this.db.query<LibraryLoan>(`select * from library_loans order by issued_at desc`);
  }

  async renewLoan(id: string): Promise<LibraryLoan> {
    const { userId } = TenantContextStore.current();
    const loan = await this.findLoan(id);
    if (loan.status !== 'on_loan') {
      throw new ConflictException(`Cannot renew loan ${id}: it is '${loan.status}', not 'on_loan'`);
    }
    if (new Date(loan.due_date) < new Date()) {
      throw new ConflictException(`Cannot renew loan ${id}: it is already overdue — return it instead`);
    }
    const rows = await this.db.query<LibraryLoan>(
      `update library_loans
       set due_date = due_date + $1 * interval '1 day', renewal_count = renewal_count + 1, updated_at = now(), updated_by = $2
       where id = $3
       returning *`,
      [RENEWAL_EXTENSION_DAYS, userId, id],
    );
    return rows[0];
  }

  async returnLoan(id: string): Promise<LibraryLoan> {
    const { userId } = TenantContextStore.current();
    await this.db.query('BEGIN');
    try {
      const loanRows = await this.db.query<LibraryLoan>(`select * from library_loans where id = $1 for update`, [
        id,
      ]);
      if (loanRows.length === 0) {
        throw new NotFoundException(`Library loan ${id} not found`);
      }
      const loan = loanRows[0];
      if (loan.status !== 'on_loan') {
        throw new ConflictException(`Cannot return loan ${id}: it is '${loan.status}', not 'on_loan'`);
      }

      const daysOverdue = Math.max(
        0,
        Math.floor((Date.now() - new Date(loan.due_date).getTime()) / (24 * 60 * 60 * 1000)),
      );
      const fine = Math.round(daysOverdue * DAILY_FINE_RATE * 100) / 100;

      await this.db.query(
        `update library_items set available_copies = available_copies + 1, updated_at = now(), updated_by = $1 where id = $2`,
        [userId, loan.item_id],
      );
      const rows = await this.db.query<LibraryLoan>(
        `update library_loans
         set status = 'returned', returned_at = now(), fine_amount = $1, updated_at = now(), updated_by = $2
         where id = $3
         returning *`,
        [fine, userId, id],
      );
      await this.db.query('COMMIT');
      return rows[0];
    } catch (err) {
      await this.db.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }

  async payFine(id: string): Promise<LibraryLoan> {
    const { userId } = TenantContextStore.current();
    const loan = await this.findLoan(id);
    if (Number(loan.fine_amount) <= 0) {
      throw new ConflictException(`Loan ${id} has no outstanding fine`);
    }
    if (loan.fine_paid) {
      throw new ConflictException(`Loan ${id}'s fine is already paid`);
    }
    const rows = await this.db.query<LibraryLoan>(
      `update library_loans set fine_paid = true, updated_at = now(), updated_by = $1 where id = $2 returning *`,
      [userId, id],
    );
    return rows[0];
  }
}
