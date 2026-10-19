import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ReportDialog } from './report-dialog';

describe('ReportDialog', () => {
  beforeEach(() => {
    // jsdom has <dialog> without the modal methods.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
      this.open = false;
    };
    TestBed.configureTestingModule({ imports: [ReportDialog], providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  function setup() {
    const fixture = TestBed.createComponent(ReportDialog);
    fixture.detectChanges();
    fixture.componentInstance.open({ id: 'oab_q1', examId: 'oab', label: 'Questão 1 · OAB' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.includes(text))!;
    return { fixture, el, button };
  }

  it('sends the chosen reason with the comment and thanks the user', () => {
    const { fixture, el, button } = setup();
    const reported: string[] = [];
    fixture.componentInstance.reported.subscribe((id) => reported.push(id));

    expect(button('Enviar').disabled).toBe(true);
    button('O gabarito está errado').click();
    const textarea = el.querySelector('textarea')!;
    textarea.value = ' A certa é a C ';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    button('Enviar').click();

    const req = TestBed.inject(HttpTestingController).expectOne('api/questions/reports');
    expect(req.request.body).toEqual({ examId: 'oab', questionId: 'oab_q1', reason: 'wrong_answer', comment: 'A certa é a C' });
    req.flush({ ok: true });
    fixture.detectChanges();
    expect(el.textContent).toContain('Obrigado!');
    expect(reported).toEqual(['oab_q1']);
  });

  it('"Outro problema" needs a description', () => {
    const { fixture, el, button } = setup();
    button('Outro problema').click();
    fixture.detectChanges();
    expect(button('Enviar').disabled).toBe(true);

    const textarea = el.querySelector('textarea')!;
    textarea.value = 'Questão repetida';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(button('Enviar').disabled).toBe(false);
  });
});
