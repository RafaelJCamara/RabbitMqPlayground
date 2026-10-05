import { Component } from '@angular/core';
import { APP_DISCLAIMER, APP_NAME } from './core/app-info';

@Component({
  selector: 'rmq-root',
  templateUrl: './app.html',
})
export class App {
  protected readonly name = APP_NAME;
  protected readonly disclaimer = APP_DISCLAIMER;
}
