import { IsIn } from 'class-validator';

const ACTION_TYPES = ['financial_reversal', 'data_export', 'permission_change'] as const;

export class RequestSensitiveApprovalDto {
  @IsIn(ACTION_TYPES)
  actionType!: (typeof ACTION_TYPES)[number];
}
