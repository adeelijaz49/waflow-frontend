import { HttpClient } from '@angular/common/http';
import { Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { lastValueFrom } from 'rxjs';

const BACKEND_URL = 'https://whatsapp-flow-edacc5b0cwdre9af.westeurope-01.azurewebsites.net';
const BUYER_PHONE = '61422286126';

const PRODUCTS = [
  {
    image: 'assets/Promotion 1.png',
    name: 'Waflow Starter Pack',
    price: '1.00',
    message: '🌟 Waflow Starter Pack\nOnly $1.00 AUD — perfect for getting started!',
  },
  {
    image: 'assets/Promotion 2.png',
    name: 'Waflow Pro Bundle',
    price: '2.00',
    message: '🚀 Waflow Pro Bundle\nOnly $2.00 AUD — level up your experience!',
  },
  {
    image: 'assets/Promotion 3.png',
    name: 'Waflow Premium Kit',
    price: '3.00',
    message: '💎 Waflow Premium Kit\nOnly $3.00 AUD — our best value offer!',
  },
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
    this.sendProducts();
  }

  private async fetchImageAsBlob(path: string): Promise<Blob> {
    const response = await fetch(path);
    return response.blob();
  }

  async sendProducts() {
    for (const product of PRODUCTS) {
      try {
        const formData = new FormData();
        formData.append('to', BUYER_PHONE);
        formData.append('message', product.message);
        formData.append('productName', product.name);
        formData.append('price', product.price);

        const blob = await this.fetchImageAsBlob(product.image);
        const filename = product.image.split('/').pop()!;
        formData.append('images', blob, filename);

        const res = await lastValueFrom(
          this.http.post(`${BACKEND_URL}/send-message`, formData)
        );
        console.log(`Sent ${product.name}:`, res);
      } catch (err) {
        console.error(`Error sending ${product.name}:`, err);
      }
    }
  }
}
