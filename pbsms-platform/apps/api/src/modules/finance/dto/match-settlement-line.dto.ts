import { IsUuidLike } from '../../../common/validation/is-uuid-like';

export class MatchSettlementLineDto {
  @IsUuidLike()
  paymentId!: string;
}
