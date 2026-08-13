import { IsIn } from 'class-validator';
import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class AssignPlanDto {
  @IsUuidLike()
  planId!: string;

  @IsIn(['monthly', 'termly'])
  billingCycle!: string;
}
