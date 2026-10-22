import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COMPANY } from '../../core/company';

@Component({
  selector: 'app-sobre-page',
  imports: [RouterLink],
  templateUrl: './sobre.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SobrePage {
  protected readonly company = COMPANY;
}
