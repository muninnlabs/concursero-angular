import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COMPANY } from '../../core/company';

@Component({
  selector: 'app-contato-page',
  imports: [RouterLink],
  templateUrl: './contato.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContatoPage {
  protected readonly company = COMPANY;
}
