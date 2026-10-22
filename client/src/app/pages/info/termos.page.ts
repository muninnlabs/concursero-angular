import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COMPANY, LEGAL_UPDATED_AT } from '../../core/company';

@Component({
  selector: 'app-termos-page',
  imports: [RouterLink],
  templateUrl: './termos.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TermosPage {
  protected readonly company = COMPANY;
  protected readonly updatedAt = LEGAL_UPDATED_AT;
}
