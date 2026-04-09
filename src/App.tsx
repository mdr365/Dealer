/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useMemo, useEffect } from 'react';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Users, 
  Plus, 
  TrendingUp,
  AlertCircle,
  Clock,
  LogOut,
  LogIn
} from 'lucide-react';
import { 
  Card, 
  CardContent, 
  CardHeader, 
  CardTitle,
  CardDescription 
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger,
  DialogFooter
} from '@/components/ui/dialog';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer
} from 'recharts';
import { format } from 'date-fns';
import { Product, Sale, Customer } from '@/src/types';
import { cn } from '@/lib/utils';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  doc, 
  setDoc,
  getDoc,
  query,
  orderBy,
  limit
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged,
  User 
} from 'firebase/auth';
import { db, auth } from '@/src/firebase';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Data States
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);

  // Form States
  const [newProduct, setNewProduct] = useState<Partial<Product>>({ unit: 'pcs' });
  const [newSale, setNewSale] = useState<Partial<Sale>>({ isCredit: false, paidAmount: 0 });
  const [isProductDialogOpen, setIsProductDialogOpen] = useState(false);
  const [isSaleDialogOpen, setIsSaleDialogOpen] = useState(false);

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Firestore Listeners
  useEffect(() => {
    if (!user) return;

    const unsubProducts = onSnapshot(collection(db, 'products'), (snapshot) => {
      setProducts(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Product)));
    });

    const unsubSales = onSnapshot(query(collection(db, 'sales'), orderBy('date', 'desc')), (snapshot) => {
      setSales(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Sale)));
    });

    const unsubCustomers = onSnapshot(collection(db, 'customers'), (snapshot) => {
      setCustomers(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Customer)));
    });

    return () => {
      unsubProducts();
      unsubSales();
      unsubCustomers();
    };
  }, [user]);

  // Dashboard Calculations
  const stats = useMemo(() => {
    const totalSales = sales.reduce((acc, sale) => acc + sale.totalPrice, 0);
    const totalPaid = sales.reduce((acc, sale) => acc + sale.paidAmount, 0);
    const totalDue = totalSales - totalPaid;
    const lowStockCount = products.filter(p => p.stock < 10).length;
    
    // Chart data
    const salesByDate = sales.reduce((acc: any, sale) => {
      const date = format(new Date(sale.date), 'MMM dd');
      acc[date] = (acc[date] || 0) + sale.totalPrice;
      return acc;
    }, {});

    const chartData = Object.keys(salesByDate).map(date => ({
      name: date,
      amount: salesByDate[date]
    })).slice(-7).reverse();

    return { totalSales, totalDue, lowStockCount, chartData };
  }, [sales, products]);

  // Handlers
  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleAddProduct = async () => {
    if (!newProduct.name || !newProduct.price || !newProduct.stock) return;
    try {
      await addDoc(collection(db, 'products'), {
        name: newProduct.name,
        category: newProduct.category || 'General',
        price: Number(newProduct.price),
        stock: Number(newProduct.stock),
        unit: newProduct.unit || 'pcs'
      });
      setNewProduct({ unit: 'pcs' });
      setIsProductDialogOpen(false);
    } catch (error) {
      console.error("Error adding product:", error);
    }
  };

  const handleAddSale = async () => {
    if (!newSale.productId || !newSale.quantity || !newSale.customerName) return;
    const product = products.find(p => p.id === newSale.productId);
    if (!product || product.stock < Number(newSale.quantity)) return;

    const totalPrice = product.price * Number(newSale.quantity);
    const saleData = {
      productId: product.id,
      productName: product.name,
      quantity: Number(newSale.quantity),
      totalPrice,
      customerName: newSale.customerName,
      date: new Date().toISOString(),
      isCredit: !!newSale.isCredit,
      paidAmount: Number(newSale.paidAmount || 0)
    };

    try {
      // 1. Add Sale
      await addDoc(collection(db, 'sales'), saleData);

      // 2. Update Stock
      await updateDoc(doc(db, 'products', product.id), {
        stock: product.stock - saleData.quantity
      });

      // 3. Update Customer Credit
      if (saleData.isCredit) {
        const due = saleData.totalPrice - saleData.paidAmount;
        const existingCustomer = customers.find(c => c.name === saleData.customerName);
        
        if (existingCustomer) {
          await updateDoc(doc(db, 'customers', existingCustomer.id), {
            totalDue: existingCustomer.totalDue + due
          });
        } else {
          await addDoc(collection(db, 'customers'), {
            name: saleData.customerName,
            phone: '',
            totalDue: due
          });
        }
      }

      setNewSale({ isCredit: false, paidAmount: 0 });
      setIsSaleDialogOpen(false);
    } catch (error) {
      console.error("Error adding sale:", error);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
    </div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f5f5f5] p-4">
        <Card className="w-full max-w-md shadow-xl border-none">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
              <TrendingUp size={32} />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold">ডিলারশিপ ম্যানেজার</CardTitle>
              <CardDescription>আপনার ব্যবসার যাবতীয় হিসেব এখন ক্লাউডে নিরাপদ</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button onClick={handleLogin} className="w-full h-12 text-lg bg-indigo-600 hover:bg-indigo-700">
              <LogIn className="mr-2 h-5 w-5" /> গুগল দিয়ে লগইন করুন
            </Button>
            <p className="text-center text-xs text-slate-400">
              লগইন করার মাধ্যমে আপনি আমাদের শর্তাবলীতে সম্মতি দিচ্ছেন।
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f5f5f5] font-sans text-slate-900">
      {/* Sidebar */}
      <div className="fixed left-0 top-0 h-full w-64 bg-white border-r border-slate-200 p-6 flex flex-col gap-8 shadow-sm">
        <div className="flex items-center gap-3 px-2">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-md">
            <TrendingUp size={24} />
          </div>
          <h1 className="text-xl font-bold tracking-tight">ডিলারশিপ ম্যানেজার</h1>
        </div>

        <nav className="flex flex-col gap-2">
          <NavItem 
            icon={<LayoutDashboard size={20} />} 
            label="ড্যাশবোর্ড" 
            active={activeTab === 'dashboard'} 
            onClick={() => setActiveTab('dashboard')} 
          />
          <NavItem 
            icon={<Package size={20} />} 
            label="স্টক ম্যানেজমেন্ট" 
            active={activeTab === 'stock'} 
            onClick={() => setActiveTab('stock')} 
          />
          <NavItem 
            icon={<ShoppingCart size={20} />} 
            label="সেলস রেকর্ড" 
            active={activeTab === 'sales'} 
            onClick={() => setActiveTab('sales')} 
          />
          <NavItem 
            icon={<Users size={20} />} 
            label="বাকির হিসেব" 
            active={activeTab === 'credit'} 
            onClick={() => setActiveTab('credit')} 
          />
        </nav>

        <div className="mt-auto space-y-4">
          <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100">
            <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-full border-2 border-white shadow-sm" />
            <div className="overflow-hidden">
              <p className="text-sm font-semibold truncate">{user.displayName}</p>
              <button onClick={handleLogout} className="text-xs text-rose-500 hover:text-rose-600 flex items-center gap-1">
                <LogOut size={12} /> লগআউট
              </button>
            </div>
          </div>
          <div className="p-4 bg-indigo-50 rounded-2xl">
            <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1">সাপোর্ট</p>
            <p className="text-sm text-indigo-900">ক্লাউড সিঙ্ক চালু আছে।</p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="ml-64 p-8">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">
              {activeTab === 'dashboard' && 'স্বাগতম!'}
              {activeTab === 'stock' && 'স্টক ইনভেন্টরি'}
              {activeTab === 'sales' && 'বিক্রয়ের তালিকা'}
              {activeTab === 'credit' && 'কাস্টমার লেজার'}
            </h2>
            <p className="text-slate-500 mt-1">
              {format(new Date(), 'EEEE, MMMM do yyyy')}
            </p>
          </div>

          <div className="flex gap-3">
            {activeTab === 'stock' && (
              <Dialog open={isProductDialogOpen} onOpenChange={setIsProductDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-indigo-600 hover:bg-indigo-700 shadow-md">
                    <Plus className="mr-2 h-4 w-4" /> নতুন প্রোডাক্ট
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>নতুন প্রোডাক্ট যোগ করুন</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label>নাম</Label>
                      <Input 
                        value={newProduct.name || ''} 
                        onChange={e => setNewProduct({...newProduct, name: e.target.value})} 
                        placeholder="প্রোডাক্টের নাম"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label>মূল্য (৳)</Label>
                        <Input 
                          type="number" 
                          value={newProduct.price || ''} 
                          onChange={e => setNewProduct({...newProduct, price: e.target.value})} 
                          placeholder="0.00"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>পরিমাণ</Label>
                        <Input 
                          type="number" 
                          value={newProduct.stock || ''} 
                          onChange={e => setNewProduct({...newProduct, stock: e.target.value})} 
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div className="grid gap-2">
                      <Label>ক্যাটাগরি</Label>
                      <Input 
                        value={newProduct.category || ''} 
                        onChange={e => setNewProduct({...newProduct, category: e.target.value})} 
                        placeholder="যেমন: পানীয়, বিস্কুট"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button onClick={handleAddProduct}>সংরক্ষণ করুন</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            {activeTab === 'sales' && (
              <Dialog open={isSaleDialogOpen} onOpenChange={setIsSaleDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="bg-indigo-600 hover:bg-indigo-700 shadow-md">
                    <Plus className="mr-2 h-4 w-4" /> নতুন মেমো
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>নতুন বিক্রয় এন্ট্রি</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <Label>প্রোডাক্ট সিলেক্ট করুন</Label>
                      <Select onValueChange={val => setNewSale({...newSale, productId: val})}>
                        <SelectTrigger>
                          <SelectValue placeholder="প্রোডাক্ট বেছে নিন" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map(p => (
                            <SelectItem key={p.id} value={p.id}>{p.name} (স্টক: {p.stock})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="grid gap-2">
                        <Label>পরিমাণ</Label>
                        <Input 
                          type="number" 
                          value={newSale.quantity || ''} 
                          onChange={e => setNewSale({...newSale, quantity: e.target.value})} 
                          placeholder="0"
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>কাস্টমারের নাম</Label>
                        <Input 
                          value={newSale.customerName || ''} 
                          onChange={e => setNewSale({...newSale, customerName: e.target.value})} 
                          placeholder="নাম লিখুন"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input 
                        type="checkbox" 
                        id="isCredit" 
                        checked={newSale.isCredit} 
                        onChange={e => setNewSale({...newSale, isCredit: e.target.checked})}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600"
                      />
                      <Label htmlFor="isCredit">বাকি (Credit)</Label>
                    </div>
                    {newSale.isCredit && (
                      <div className="grid gap-2">
                        <Label>জমা (Paid Amount)</Label>
                        <Input 
                          type="number" 
                          value={newSale.paidAmount || ''} 
                          onChange={e => setNewSale({...newSale, paidAmount: e.target.value})} 
                          placeholder="0.00"
                        />
                      </div>
                    )}
                  </div>
                  <DialogFooter>
                    <Button onClick={handleAddSale}>এন্ট্রি করুন</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </header>

        {/* Tab Content */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard 
                title="মোট বিক্রয়" 
                value={`৳${stats.totalSales.toLocaleString()}`} 
                icon={<TrendingUp className="text-indigo-600" />} 
                description="আজ পর্যন্ত মোট বিক্রয়"
              />
              <StatCard 
                title="মোট বাকি" 
                value={`৳${stats.totalDue.toLocaleString()}`} 
                icon={<Clock className="text-amber-600" />} 
                description="কাস্টমারদের কাছে পাওনা"
              />
              <StatCard 
                title="লো স্টক এলার্ট" 
                value={stats.lowStockCount} 
                icon={<AlertCircle className="text-rose-600" />} 
                description="১০টির নিচে থাকা প্রোডাক্ট"
              />
              <StatCard 
                title="মোট কাস্টমার" 
                value={customers.length} 
                icon={<Users className="text-emerald-600" />} 
                description="রেজিস্টার্ড কাস্টমার"
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <Card className="lg:col-span-2 border-none shadow-sm">
                <CardHeader>
                  <CardTitle>বিক্রয়ের ট্রেন্ড</CardTitle>
                  <CardDescription>গত ৭ দিনের বিক্রয়ের গ্রাফ</CardDescription>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={stats.chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} />
                      <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                      />
                      <Bar dataKey="amount" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm">
                <CardHeader>
                  <CardTitle>সাম্প্রতিক বিক্রয়</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-4">
                      {sales.slice(0, 10).map(sale => (
                        <div key={sale.id} className="flex justify-between items-center p-3 rounded-xl bg-slate-50 border border-slate-100 transition-colors hover:bg-slate-100">
                          <div>
                            <p className="font-medium text-sm">{sale.productName}</p>
                            <p className="text-[10px] text-slate-500">{sale.customerName} • {format(new Date(sale.date), 'hh:mm a')}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-sm">৳{sale.totalPrice}</p>
                            {sale.isCredit ? (
                              <Badge variant="outline" className="text-[9px] h-4 text-amber-600 border-amber-200 bg-amber-50">বাকি</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[9px] h-4 text-emerald-600 border-emerald-200 bg-emerald-50">পেইড</Badge>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'stock' && (
          <Card className="border-none shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>প্রোডাক্টের নাম</TableHead>
                    <TableHead>ক্যাটাগরি</TableHead>
                    <TableHead>মূল্য</TableHead>
                    <TableHead>স্টক</TableHead>
                    <TableHead>অবস্থা</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell>{p.category}</TableCell>
                      <TableCell>৳{p.price}</TableCell>
                      <TableCell>{p.stock} {p.unit}</TableCell>
                      <TableCell>
                        {p.stock > 10 ? (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none">ইন স্টক</Badge>
                        ) : p.stock > 0 ? (
                          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 border-none">লো স্টক</Badge>
                        ) : (
                          <Badge className="bg-rose-100 text-rose-700 hover:bg-rose-100 border-none">আউট অফ স্টক</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {products.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-20 text-slate-400">
                        কোন প্রোডাক্ট পাওয়া যায়নি।
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {activeTab === 'sales' && (
          <Card className="border-none shadow-sm overflow-hidden">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>তারিখ</TableHead>
                    <TableHead>কাস্টমার</TableHead>
                    <TableHead>প্রোডাক্ট</TableHead>
                    <TableHead>পরিমাণ</TableHead>
                    <TableHead>মোট মূল্য</TableHead>
                    <TableHead>পেমেন্ট</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sales.map(sale => (
                    <TableRow key={sale.id}>
                      <TableCell>{format(new Date(sale.date), 'dd/MM/yy')}</TableCell>
                      <TableCell className="font-medium">{sale.customerName}</TableCell>
                      <TableCell>{sale.productName}</TableCell>
                      <TableCell>{sale.quantity}</TableCell>
                      <TableCell>৳{sale.totalPrice}</TableCell>
                      <TableCell>
                        {sale.isCredit ? (
                          <div className="flex flex-col">
                            <Badge variant="outline" className="w-fit text-amber-600 border-amber-200">বাকি</Badge>
                            <span className="text-[10px] text-slate-500">পেইড: ৳{sale.paidAmount}</span>
                          </div>
                        ) : (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-200">পেইড</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {activeTab === 'credit' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {customers.map(customer => (
              <Card key={customer.id} className="overflow-hidden border-none shadow-sm hover:shadow-md transition-shadow">
                <CardHeader className="bg-slate-50 pb-4">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg">{customer.name}</CardTitle>
                    <Badge className="bg-rose-100 text-rose-700 border-none">বাকি আছে</Badge>
                  </div>
                  <CardDescription>{customer.phone || 'ফোন নম্বর নেই'}</CardDescription>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">মোট পাওনা:</span>
                    <span className="text-2xl font-bold text-rose-600">৳{customer.totalDue.toLocaleString()}</span>
                  </div>
                  <Button variant="outline" className="w-full mt-4 border-slate-200 hover:bg-slate-50 rounded-xl">
                    বিস্তারিত দেখুন
                  </Button>
                </CardContent>
              </Card>
            ))}
            {customers.length === 0 && (
              <div className="col-span-full text-center py-20 bg-white rounded-3xl border border-dashed border-slate-300">
                <Users className="mx-auto h-12 w-12 text-slate-300 mb-4" />
                <p className="text-slate-400">এখনও কোন বাকির হিসেব নেই।</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: any, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
        active 
          ? "bg-indigo-600 text-white shadow-lg shadow-indigo-200" 
          : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      )}
    >
      <span className={cn(active ? "text-white" : "text-slate-400 group-hover:text-slate-900")}>
        {icon}
      </span>
      <span className="font-medium">{label}</span>
    </button>
  );
}

function StatCard({ title, value, icon, description }: { title: string, value: string | number, icon: any, description: string }) {
  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-slate-500">{title}</CardTitle>
        <div className="p-2 bg-slate-50 rounded-lg">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="text-xs text-slate-400 mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

