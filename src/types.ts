export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  unit: string;
}

export interface Sale {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  totalPrice: number;
  customerName: string;
  date: string;
  isCredit: boolean;
  paidAmount: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  totalDue: number;
}
