import { ArrowBackIcon } from '@chakra-ui/icons';
import { HStack, IconButton, Text, VStack } from '@chakra-ui/react';
import { TxStep } from 'hooks/useTransaction';
import { NextRouter, useRouter } from "next/router";
import { FC, useEffect, useState } from 'react';
import { useRecoilState, useRecoilValue } from 'recoil';
import { walletState } from 'state/atoms/walletAtoms';
import { TokenItemState, tokenLpAtom } from '../ManageLiquidity/lpAtoms';
import useProvideLP from "./hooks/useProvideLP";
import NewPositionForm from './NewPositionForm';
import defaultTokens from './defaultTokens.json'


const NewPosition: FC = () => {
    const router: NextRouter = useRouter()

    const [[tokenA, tokenB], setTokenSwapState] = useRecoilState<TokenItemState[]>(tokenLpAtom)
    const { chainId, key } = useRecoilValue(walletState)
    const [resetForm, setResetForm] = useState(false)

    useEffect(() => {
        if (chainId) {
            const [from, to] = defaultTokens[chainId]
            const params = `?from=${from?.tokenSymbol}&to=${to?.tokenSymbol}`
            setTokenSwapState([from, to])
            setResetForm(true)
            router.replace(params)
        }
    }, [chainId])

    useEffect(() => {
        const params = `?from=${tokenA?.tokenSymbol}&to=${tokenB?.tokenSymbol}`
        router.replace(params, undefined, { shallow: true })
    }, [tokenA, tokenB])

    const onInputChange = ({ tokenSymbol, amount }: TokenItemState, index: number) => {
        if (tx?.txStep === TxStep.Failed || tx?.txStep === TxStep.Success)
            tx.reset()

        const newState: TokenItemState[] = [tokenA, tokenB]
        newState[index] = {
            tokenSymbol: tokenSymbol,
            amount: Number(amount)
        }

        setTokenSwapState(newState)
    }

    const { simulated, tx } = useProvideLP()


    return (
        <VStack width={{ base: '100%', md: '700px' }} alignItems="center" padding={5} margin="auto">
            <HStack justifyContent="space-between" width="full" paddingY={5} paddingX={{ base: 4, md: 14 }} >
                <IconButton
                    variant="unstyled"
                    color="#7A7A7A"
                    fontSize="28px"
                    aria-label='go back'
                    icon={<ArrowBackIcon />}
                    onClick={() => router.back()}
                />
                <Text as="h2" fontSize="24" fontWeight="900">New position</Text>
            </HStack>

            <NewPositionForm
                connected={Boolean(key?.name)}
                tokenA={tokenA}
                tokenB={tokenB}
                onInputChange={onInputChange}
                simulated={simulated}
                tx={tx}
                resetForm={resetForm}
                setResetForm={setResetForm}

            />
        </VStack>
    )
}

export default NewPosition