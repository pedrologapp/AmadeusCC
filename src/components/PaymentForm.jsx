import React, { useState } from 'react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Separator } from './ui/separator';
import { Badge } from './ui/badge';
import { 
  CreditCard, 
  User, 
  Mail, 
  Phone, 
  Calendar,
  CheckCircle,
  AlertCircle,
  X
} from 'lucide-react';

const PaymentForm = ({ isOpen, onClose }) => {
  const [formData, setFormData] = useState({
    studentName: '',
    parentName: '',
    email: '',
    phone: '',
    paymentMethod: 'credit',
    cardNumber: '',
    cardName: '',
    expiryDate: '',
    cvv: '',
    installments: '1'
  });

  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsProcessing(true);
    
    // Simular processamento de pagamento
    setTimeout(() => {
      setIsProcessing(false);
      setPaymentSuccess(true);
    }, 3000);
  };

  const formatCardNumber = (value) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    const matches = v.match(/\d{4,16}/g);
    const match = matches && matches[0] || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    if (parts.length) {
      return parts.join(' ');
    } else {
      return v;
    }
  };

  const formatExpiryDate = (value) => {
    const v = value.replace(/\s+/g, '').replace(/[^0-9]/gi, '');
    if (v.length >= 2) {
      return v.substring(0, 2) + '/' + v.substring(2, 4);
    }
    return v;
  };

  if (!isOpen) return null;

  if (paymentSuccess) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 p-3 bg-green-100 rounded-full w-fit">
              <CheckCircle className="h-8 w-8 text-green-600" />
            </div>
            <CardTitle className="text-green-600">Pagamento Confirmado!</CardTitle>
            <CardDescription>
              Sua inscrição foi realizada com sucesso
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-6">
              Você receberá um e-mail de confirmação em breve com todos os detalhes da viagem.
            </p>
            <Button onClick={onClose} className="w-full">
              Fechar
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <Card className="w-full max-w-2xl my-8">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="flex items-center">
                <CreditCard className="mr-2 h-5 w-5" />
                Formulário de Inscrição e Pagamento
              </CardTitle>
              <CardDescription>
                Complete os dados para finalizar a inscrição
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Dados do Aluno */}
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <User className="mr-2 h-5 w-5" />
                Dados do Aluno
              </h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="studentName">Nome Completo do Aluno *</Label>
                  <Input
                    id="studentName"
                    name="studentName"
                    value={formData.studentName}
                    onChange={handleInputChange}
                    required
                    placeholder="Nome completo do aluno"
                  />
                </div>
                <div>
                  <Label htmlFor="parentName">Nome do Responsável *</Label>
                  <Input
                    id="parentName"
                    name="parentName"
                    value={formData.parentName}
                    onChange={handleInputChange}
                    required
                    placeholder="Nome do responsável"
                  />
                </div>
              </div>
            </div>

            {/* Dados de Contato */}
            <div>
              <h3 className="text-lg font-semibold mb-4 flex items-center">
                <Mail className="mr-2 h-5 w-5" />
                Dados de Contato
              </h3>
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="email">E-mail *</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    placeholder="seu@email.com"
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Telefone *</Label>
                  <Input
                    id="phone"
                    name="phone"
                    value={formData.phone}
                    onChange={handleInputChange}
                    required
                    placeholder="(84) 99999-9999"
                  />
                </div>
              </div>
            </div>

            <Separator />

            {/* Resumo do Pagamento */}
            <div className="bg-muted/30 p-4 rounded-lg">
              <h3 className="text-lg font-semibold mb-3">Resumo do Pagamento</h3>
              <div className="flex justify-between items-center mb-2">
                <span>Viagem de Estudos - Instituto Ricardo Brennand</span>
                <span className="font-semibold">R$ 320,00</span>
              </div>
              <div className="text-sm text-muted-foreground">
                Inclui: Transporte, guias, ingresso e almoço
              </div>
            </div>

            {/* Método de Pagamento */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Método de Pagamento</h3>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <Button
                  type="button"
                  variant={formData.paymentMethod === 'credit' ? 'default' : 'outline'}
                  onClick={() => setFormData(prev => ({ ...prev, paymentMethod: 'credit' }))}
                  className="h-auto p-4"
                >
                  <div className="text-center">
                    <CreditCard className="h-6 w-6 mx-auto mb-2" />
                    <div>Cartão de Crédito</div>
                    <div className="text-xs opacity-70">Até 3x sem juros</div>
                  </div>
                </Button>
                <Button
                  type="button"
                  variant={formData.paymentMethod === 'pix' ? 'default' : 'outline'}
                  onClick={() => setFormData(prev => ({ ...prev, paymentMethod: 'pix' }))}
                  className="h-auto p-4"
                >
                  <div className="text-center">
                    <div className="text-lg font-bold mb-2">PIX</div>
                    <div className="text-xs opacity-70">Pagamento à vista</div>
                  </div>
                </Button>
              </div>

              {formData.paymentMethod === 'credit' && (
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="cardNumber">Número do Cartão *</Label>
                    <Input
                      id="cardNumber"
                      name="cardNumber"
                      value={formatCardNumber(formData.cardNumber)}
                      onChange={(e) => setFormData(prev => ({ ...prev, cardNumber: e.target.value }))}
                      required
                      placeholder="1234 5678 9012 3456"
                      maxLength={19}
                    />
                  </div>
                  <div>
                    <Label htmlFor="cardName">Nome no Cartão *</Label>
                    <Input
                      id="cardName"
                      name="cardName"
                      value={formData.cardName}
                      onChange={handleInputChange}
                      required
                      placeholder="Nome como está no cartão"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="expiryDate">Validade *</Label>
                      <Input
                        id="expiryDate"
                        name="expiryDate"
                        value={formatExpiryDate(formData.expiryDate)}
                        onChange={(e) => setFormData(prev => ({ ...prev, expiryDate: e.target.value }))}
                        required
                        placeholder="MM/AA"
                        maxLength={5}
                      />
                    </div>
                    <div>
                      <Label htmlFor="cvv">CVV *</Label>
                      <Input
                        id="cvv"
                        name="cvv"
                        value={formData.cvv}
                        onChange={handleInputChange}
                        required
                        placeholder="123"
                        maxLength={4}
                      />
                    </div>
                    <div>
                      <Label htmlFor="installments">Parcelas</Label>
                      <select
                        id="installments"
                        name="installments"
                        value={formData.installments}
                        onChange={handleInputChange}
                        className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                      >
                        <option value="1">1x R$ 320,00</option>
                        <option value="2">2x R$ 160,00</option>
                        <option value="3">3x R$ 106,67</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {formData.paymentMethod === 'pix' && (
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="flex items-start space-x-3">
                    <AlertCircle className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <h4 className="font-semibold text-blue-900">Pagamento via PIX</h4>
                      <p className="text-sm text-blue-700">
                        Após confirmar, você receberá o código PIX por e-mail para realizar o pagamento.
                        O prazo para pagamento é de 24 horas.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Termos e Condições */}
            <div className="bg-yellow-50 p-4 rounded-lg">
              <div className="flex items-start space-x-3">
                <AlertCircle className="h-5 w-5 text-yellow-600 mt-0.5" />
                <div className="text-sm">
                  <p className="font-semibold text-yellow-900 mb-2">Importante:</p>
                  <ul className="text-yellow-800 space-y-1">
                    <li>• Pagamento deve ser realizado até 15 de agosto de 2025</li>
                    <li>• A ficha de autorização deve ser entregue na secretaria</li>
                    <li>• Não haverá redução de valor para itens não utilizados</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Botões */}
            <div className="flex space-x-4">
              <Button 
                type="button" 
                variant="outline" 
                className="flex-1"
                onClick={onClose}
                disabled={isProcessing}
              >
                Cancelar
              </Button>
              <Button 
                type="submit" 
                className="flex-1"
                disabled={isProcessing}
              >
                {isProcessing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                    Processando...
                  </>
                ) : (
                  `Confirmar ${formData.paymentMethod === 'pix' ? 'PIX' : 'Pagamento'}`
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentForm;

