import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  let signIn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    signIn = vi.fn().mockResolvedValue(null);
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), { provide: AuthService, useValue: { signInWithGoogle: signIn } }],
    });
  });

  it('keeps Google sign-in disabled until the terms are accepted', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const button = el.querySelector<HTMLButtonElement>('button.google')!;
    const checkbox = el.querySelector<HTMLInputElement>('.consent input')!;

    expect(button.disabled).toBe(true);
    button.click();
    expect(signIn).not.toHaveBeenCalled();

    checkbox.click();
    fixture.detectChanges();
    expect(button.disabled).toBe(false);
  });

  it('links the terms and the privacy policy', () => {
    const fixture = TestBed.createComponent(LoginPage);
    fixture.detectChanges();
    const hrefs = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.consent a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/termos', '/privacidade']);
  });
});
