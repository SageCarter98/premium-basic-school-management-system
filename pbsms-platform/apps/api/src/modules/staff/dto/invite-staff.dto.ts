import { ArrayMinSize, IsArray, IsEmail, IsIn, IsNotEmpty, IsString } from 'class-validator';

// Every role_code this codebase's role-groups.ts constants actually
// compose from (Chapter 3.2) — tenant_users.role_code has no DB-level
// CHECK (0001_init_tenancy.sql's comment: "or a platform role code", so a
// DB constraint would have to also allow platform codes), so this is the
// application-level equivalent for the one write path that creates a
// brand new tenant_users row from scratch.
export const INVITABLE_ROLE_CODES = [
  'proprietor',
  'administrator',
  'headmaster',
  'assistant_headmaster',
  'academic_coordinator',
  'examination_officer',
  'admission_officer',
  'teacher',
  'accountant',
  'librarian',
  'transport_officer',
  'health_officer',
  'storekeeper',
];

export class InviteStaffDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(INVITABLE_ROLE_CODES, { each: true })
  roleCodes!: string[];
}
