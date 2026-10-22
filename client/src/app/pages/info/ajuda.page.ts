import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-ajuda-page',
  imports: [RouterLink],
  templateUrl: './ajuda.page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AjudaPage {}
