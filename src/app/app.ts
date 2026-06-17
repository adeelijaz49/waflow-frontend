import { HttpClient } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';

const PROMOTION_IMAGES = [
  'assets/Promotion 1.png',
  'assets/Promotion 2.png',
  'assets/Promotion 3.png',
];

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  protected readonly title = signal('market-me');

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.sendMessage();
  }

  private async fetchImageAsBlob(path: string): Promise<Blob> {
    const response = await fetch(path);
    return response.blob();
  }

  async sendMessage() {
    const formData = new FormData();
    formData.append('to', '61422286126');
    formData.append('message', 'Hello, This is Adeel Ijaz, about to start a new billion dollar business with Mr. A D');

    for (const imagePath of PROMOTION_IMAGES) {
      const blob = await this.fetchImageAsBlob(imagePath);
      const filename = imagePath.split('/').pop()!;
      formData.append('images', blob, filename);
    }

    this.http.post('https://whatsapp-flow-edacc5b0cwdre9af.westeurope-01.azurewebsites.net/send-message', formData).subscribe({
      next: (res: any) => console.log('Backend response:', res),
      error: (err) => console.error('Frontend error:', err),
    });
  }
}