import { describe, expect, it } from 'vitest'
import { primerSimbolo } from './simbolos'

describe('primerSimbolo', () => {
  it('se queda con el primero de una lista', () => {
    expect(primerSimbolo('AAPL,MSFT')).toBe('AAPL')
    expect(primerSimbolo(' AAPL , MSFT ')).toBe('AAPL')
  })
  it('lo vacío no es un ticker', () => {
    expect(primerSimbolo('')).toBeNull()
    expect(primerSimbolo(' , ')).toBeNull()
    expect(primerSimbolo(null)).toBeNull()
    expect(primerSimbolo(undefined)).toBeNull()
  })
})
