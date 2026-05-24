import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface AmountThreshold {
  minAmount: number;
  maxAmount: number | null; // null = no upper bound
  branchId: string;
}

@Injectable()
export class BranchSelectorService {
  private readonly logger = new Logger(BranchSelectorService.name);
  private readonly branchMap: Record<string, string>; // conditionKey → branchId
  private readonly amountThresholds: AmountThreshold[];
  private readonly defaultBranchId: string | null;

  constructor(private readonly configService: ConfigService) {
    // TRUSTID_BRANCH_MAP env var: '{"high_value":"branch-id-1","right_to_work":"branch-id-2"}'
    const rawMap = this.configService.get<string>('trustid.branchMap') ?? '{}';
    this.branchMap = JSON.parse(rawMap);

    // TRUSTID_AMOUNT_THRESHOLDS env var: '[{"minAmount":0,"maxAmount":1000,"branchId":"id1"},{"minAmount":1000,"maxAmount":null,"branchId":"id2"}]'
    const rawThresholds = this.configService.get<string>('trustid.amountThresholds') ?? '[]';
    this.amountThresholds = JSON.parse(rawThresholds);

    this.defaultBranchId = this.configService.get<string>('trustid.defaultBranchId') ?? null;
  }

  /** Return the branchId for a named condition key. Returns null if not configured. */
  getBranchForCondition(conditionKey: string): string | null {
    return this.branchMap[conditionKey] ?? null;
  }

  /** Return the branchId for a given amount. Uses the first matching threshold range. */
  getBranchForAmount(amount: number): string | null {
    for (const threshold of this.amountThresholds) {
      const aboveMin = amount >= threshold.minAmount;
      const belowMax = threshold.maxAmount === null || amount < threshold.maxAmount;
      if (aboveMin && belowMax) return threshold.branchId;
    }
    return null;
  }

  /** Resolve branchId from amount, condition, or configured default. Returns null if nothing matches. */
  resolveBranchId(amount?: number, conditionKey?: string): string | null {
    if (conditionKey) {
      const b = this.getBranchForCondition(conditionKey);
      if (b) {
        this.logger.log({ message: 'Branch resolved by conditionKey', conditionKey, branchId: b });
        return b;
      }
    }
    if (amount !== undefined) {
      const b = this.getBranchForAmount(amount);
      if (b) {
        this.logger.log({ message: 'Branch resolved by amount', amount, branchId: b });
        return b;
      }
    }
    return this.defaultBranchId;
  }
}
