import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Analytics } from './core/analytics';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
})
export class App {
  constructor() {
    inject(Analytics).start();
  }
}
