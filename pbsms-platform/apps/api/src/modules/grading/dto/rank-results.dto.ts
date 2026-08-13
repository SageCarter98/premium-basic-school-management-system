import { IsIn } from 'class-validator';

const RANK_MODES = ['competition', 'dense', 'none'];

/** rank-results.dto.ts — FR-GRA-050: competition ("1224") skips ranks
 * after a tie, dense ("1223") does not, none disables ranking entirely
 * (forced by grading.service.ts regardless of the requested mode when the
 * policy is 'developmental'). */
export class RankResultsDto {
  @IsIn(RANK_MODES)
  mode!: string;
}
