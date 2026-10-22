import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COMPANY, LEGAL_UPDATED_AT } from '../../core/company';

@Component({
  selector: 'app-privacidade-page',
  imports: [RouterLink],
  templateUrl: './privacidade.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PrivacidadePage {
  protected readonly company = COMPANY;
  protected readonly updatedAt = LEGAL_UPDATED_AT;
}
